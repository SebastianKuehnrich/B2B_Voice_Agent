"""
finetune.py – TalentFlow Voice Agent Fine-Tuning Pipeline
==========================================================
Trainiert einen deutschen BERT-Classifier auf den TalentFlow-Gesprächsdaten.

Zwei Modi:
  1. GRADE CLASSIFIER  – Vorhersage von Lead Grade A/B/C aus Gesprächs-Snippet
                         (schnell, kein GPU/Token nötig, sofort nützlich)
  2. SFT FULL          – Full Conversation Fine-Tuning mit LoRA auf LeoLM
                         (GPU + HuggingFace Token erforderlich)

Voraussetzungen:
  pip install transformers datasets peft trl torch sentencepiece python-dotenv
  HUGGINGFACE_TOKEN in .env (nur für --mode sft)

Ausführung:
  python gradio/finetune.py --mode classifier        # Lead-Grade Classifier
  python gradio/finetune.py --mode sft               # SFT mit LoRA (braucht GPU + HF Token)
  python gradio/finetune.py --mode classifier --wandb  # + wandb Tracking
  python gradio/finetune.py --mode test              # Trainierten Classifier testen
"""

import argparse
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

# ─────────────────────────────────────────────────────────────────────────────
# Pfade
# ─────────────────────────────────────────────────────────────────────────────
BASE_DIR   = Path(__file__).parent.parent
DATA_DIR   = BASE_DIR / "data"
OUTPUT_DIR = BASE_DIR / "data" / "model_output"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# ─────────────────────────────────────────────────────────────────────────────
# Modell-Auswahl
# ─────────────────────────────────────────────────────────────────────────────
MODELS = {
    "classifier": "bert-base-german-cased",          # Kein Token, CPU-kompatibel
    "sft":        "LeoLM/leo-mistral-hessianai-7b",  # Braucht HF-Token + GPU (16GB VRAM)
    "sft_small":  "LeoLM/leo-hessianai-3b",          # Braucht HF-Token + GPU (8GB VRAM)
}

TRAIN_FILE = DATA_DIR / "talentflow_train.jsonl"
EVAL_FILE  = DATA_DIR / "talentflow_eval.jsonl"


# ─────────────────────────────────────────────────────────────────────────────
# Hilfsfunktion: Datei-Existenz prüfen (defensive)
# ─────────────────────────────────────────────────────────────────────────────
def _check_data_files() -> bool:
    """Prüft ob Train/Eval JSONL Dateien vorhanden sind."""
    missing = [str(p) for p in [TRAIN_FILE, EVAL_FILE] if not p.exists()]
    if missing:
        print("FEHLER: Datendateien fehlen:")
        for m in missing:
            print(f"   {m}")
        print("\n   Zuerst ausführen: python gradio/generate_dataset.py")
        return False
    return True


def _load_jsonl(path: Path) -> list[dict]:
    """Liest eine JSONL-Datei zeilenweise, überspringt fehlerhafte Zeilen."""
    records = []
    with open(path, encoding="utf-8") as f:
        for lineno, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError as e:
                print(f"WARNUNG: Zeile {lineno} in {path.name} übersprungen: {e}")
    return records


# ─────────────────────────────────────────────────────────────────────────────
# MODUS 1: Lead-Grade Classifier
# Trainiert bert-base-german-cased als 3-Klassen-Classifier (A / B / C)
# Kein HuggingFace Token, läuft auf CPU
# ─────────────────────────────────────────────────────────────────────────────

def run_classifier_training(use_wandb: bool = False) -> None:
    """
    Trainiert bert-base-german-cased als 3-Klassen Classifier (A/B/C).
    Kein HuggingFace Token benötigt, läuft auf CPU oder kleiner GPU.
    """
    # ── Imports ────────────────────────────────────────────────────────────────
    try:
        import numpy as np
        from datasets import Dataset
        from transformers import (
            AutoModelForSequenceClassification,
            AutoTokenizer,
            Trainer,
            TrainingArguments,
        )
    except ImportError as e:
        print(f"FEHLER: Fehlende Abhaengigkeit: {e}")
        print("   Bitte ausfuehren: pip install transformers datasets numpy torch")
        return

    # ── Datendateien prüfen ────────────────────────────────────────────────────
    if not _check_data_files():
        return

    print("Modus: Lead-Grade Classifier (bert-base-german-cased)")
    print(f"   Modell: {MODELS['classifier']}")
    print(f"   Output: {OUTPUT_DIR / 'grade_classifier'}")

    # ── Label-Mapping ──────────────────────────────────────────────────────────
    label2id = {"A": 0, "B": 1, "C": 2}
    id2label  = {0: "A", 1: "B", 2: "C"}

    # ── Dataset-Aufbereitung ───────────────────────────────────────────────────
    def _grade_from_conversation(msgs: list[dict]) -> str:
        """
        Leitet den Lead-Grade heuristisch aus dem letzten Assistant-Turn ab.
        In Produktionsdaten käme das Label direkt aus dem Dataset-Feld.
        """
        last_assistant = next(
            (m["content"] for m in reversed(msgs) if m["role"] == "assistant"),
            "",
        ).lower()

        booking_signals   = ["gebucht", "kalender-einladung", "demo-termin", "dienstag",
                              "mittwoch", "donnerstag", "freitag", "montag", "eingetragen"]
        nurture_signals   = ["informationen schicke", "melde mich", "unterlagen", "schicke ihnen"]

        if any(w in last_assistant for w in booking_signals):
            return "A"
        if any(w in last_assistant for w in nurture_signals):
            return "B"
        return "C"

    def _build_samples(records: list[dict]) -> list[dict]:
        samples = []
        for record in records:
            msgs = record.get("messages", [])
            if not msgs:
                continue
            # Konversation als Text (System-Prompt weglassen – zu lang)
            text = " [SEP] ".join(
                f"{m['role'].upper()}: {m['content'][:200]}"
                for m in msgs
                if m.get("role") != "system" and m.get("content")
            )
            grade = _grade_from_conversation(msgs)
            samples.append({"text": text, "label": label2id[grade]})
        return samples

    train_records = _load_jsonl(TRAIN_FILE)
    eval_records  = _load_jsonl(EVAL_FILE)

    train_data = _build_samples(train_records)
    eval_data  = _build_samples(eval_records)

    if not train_data:
        print("FEHLER: Keine Trainingsdaten gefunden. Prüfe talentflow_train.jsonl")
        return

    print(f"   Train: {len(train_data)} | Eval: {len(eval_data)}")

    train_dataset = Dataset.from_list(train_data)
    eval_dataset  = Dataset.from_list(eval_data)

    # ── Tokenizer & Modell laden ────────────────────────────────────────────────
    tokenizer = AutoTokenizer.from_pretrained(MODELS["classifier"])
    model = AutoModelForSequenceClassification.from_pretrained(
        MODELS["classifier"],
        num_labels             = 3,
        id2label               = id2label,
        label2id               = label2id,
        ignore_mismatched_sizes= True,   # Unterdrückt LOAD REPORT (neuer Classifier-Head erwartet)
    )

    # ── Tokenisierung ──────────────────────────────────────────────────────────
    def _tokenize(batch: dict) -> dict:
        return tokenizer(
            batch["text"],
            truncation  = True,
            max_length  = 512,
            padding     = "max_length",
        )

    train_dataset = train_dataset.map(_tokenize, batched=True)
    eval_dataset  = eval_dataset.map(_tokenize, batched=True)

    # ── Metrik: Accuracy ───────────────────────────────────────────────────────
    def _compute_metrics(eval_pred) -> dict:
        logits, labels = eval_pred
        predictions = np.argmax(logits, axis=-1)
        accuracy = (predictions == labels).mean()
        return {"accuracy": float(accuracy)}

    # ── Training Arguments ─────────────────────────────────────────────────────
    report_to = "wandb" if use_wandb else "none"

    training_args = TrainingArguments(
        output_dir                  = str(OUTPUT_DIR / "grade_classifier"),
        num_train_epochs            = 5,
        per_device_train_batch_size = 4,
        per_device_eval_batch_size  = 4,
        warmup_steps                = 5,
        weight_decay                = 0.01,
        logging_dir                 = str(OUTPUT_DIR / "logs"),
        logging_steps               = 5,
        eval_strategy               = "epoch",   # ehemals evaluation_strategy (deprecated >= 4.46)
        save_strategy               = "epoch",
        load_best_model_at_end      = True,
        metric_for_best_model       = "accuracy",
        greater_is_better           = True,
        report_to                   = report_to,
        run_name                    = "talentflow-grade-classifier",
    )

    # ── wandb Setup ────────────────────────────────────────────────────────────
    if use_wandb:
        try:
            import wandb
            wandb.init(
                project = "talentflow-voice-agent",
                name    = "grade-classifier-v1",
                tags    = ["classifier", "german", "b2b-sales", "lead-grade"],
                config  = {
                    "model":      MODELS["classifier"],
                    "num_labels": 3,
                    "num_epochs": 5,
                    "batch_size": 4,
                },
            )
        except ImportError:
            print("WARNUNG: wandb nicht installiert – Tracking deaktiviert")
            training_args.report_to = "none"

    # ── Trainer ────────────────────────────────────────────────────────────────
    trainer = Trainer(
        model           = model,
        args            = training_args,
        train_dataset   = train_dataset,
        eval_dataset    = eval_dataset,
        compute_metrics = _compute_metrics,
    )

    print("\nTraining startet...")
    trainer.train()

    # ── Modell speichern ───────────────────────────────────────────────────────
    save_path = OUTPUT_DIR / "grade_classifier" / "final"
    trainer.save_model(str(save_path))
    tokenizer.save_pretrained(str(save_path))
    print(f"\nClassifier gespeichert: {save_path}")

    if use_wandb:
        try:
            import wandb
            wandb.finish()
        except ImportError:
            pass


# ─────────────────────────────────────────────────────────────────────────────
# MODUS 2: SFT mit LoRA (Full Conversation Fine-Tuning)
# Trainiert LeoLM (deutsches Mistral) auf TalentFlow-Gesprächspaaren
# Benötigt: GPU + HuggingFace Token
# ─────────────────────────────────────────────────────────────────────────────

def run_sft_training(model_size: str = "small", use_wandb: bool = False) -> None:
    """
    Supervised Fine-Tuning mit LoRA auf LeoLM (deutsches Mistral).
    Benötigt: HUGGINGFACE_TOKEN in .env + GPU (mind. 8GB VRAM für 3B, 16GB für 7B).
    """
    # ── Imports ────────────────────────────────────────────────────────────────
    try:
        import torch
        from datasets import Dataset
        from peft import LoraConfig, TaskType, get_peft_model
        from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
        from trl import SFTConfig, SFTTrainer
    except ImportError as e:
        print(f"❌ Fehlende Abhängigkeit: {e}")
        print("   Bitte ausführen: pip install transformers peft trl torch bitsandbytes")
        return

    # ── Token prüfen (vor allem anderen) ──────────────────────────────────────
    hf_token = os.getenv("HUGGINGFACE_TOKEN", "").strip()
    if not hf_token:
        print("FEHLER: HUGGINGFACE_TOKEN fehlt in .env!")
        print("   Token erstellen: https://huggingface.co/settings/tokens")
        print("   Modell-Zugriff: https://huggingface.co/LeoLM/leo-hessianai-3b")
        return

    # ── GPU prüfen ─────────────────────────────────────────────────────────────
    if not torch.cuda.is_available():
        print("FEHLER: Keine CUDA GPU gefunden. SFT-Modus benoetigt eine GPU.")
        print("   Fuer CPU-Training: --mode classifier")
        return

    # ── Datendateien prüfen ────────────────────────────────────────────────────
    if not _check_data_files():
        return

    model_name = MODELS["sft_small"] if model_size == "small" else MODELS["sft"]

    print(f"Modus: SFT + LoRA")
    print(f"   Modell: {model_name}")
    print(f"   GPU: {torch.cuda.get_device_name(0)}")
    print(f"   VRAM: {torch.cuda.get_device_properties(0).total_memory / 1e9:.1f} GB")

    # ── Dataset laden ──────────────────────────────────────────────────────────
    train_data = _load_jsonl(TRAIN_FILE)
    eval_data  = _load_jsonl(EVAL_FILE)
    print(f"   Train: {len(train_data)} | Eval: {len(eval_data)}")

    # ── 4-bit Quantisierung (weniger VRAM) ────────────────────────────────────
    bnb_config = BitsAndBytesConfig(
        load_in_4bit              = True,
        bnb_4bit_quant_type       = "nf4",
        bnb_4bit_compute_dtype    = torch.float16,  # torch.dtype, kein String
        bnb_4bit_use_double_quant = True,
    )

    tokenizer = AutoTokenizer.from_pretrained(model_name, token=hf_token)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    model = AutoModelForCausalLM.from_pretrained(
        model_name,
        quantization_config = bnb_config,
        device_map          = "auto",
        token               = hf_token,
    )
    model.config.use_cache = False  # Für Gradient Checkpointing nötig

    # ── LoRA Konfiguration ─────────────────────────────────────────────────────
    lora_config = LoraConfig(
        r              = 16,
        lora_alpha     = 32,
        target_modules = ["q_proj", "v_proj", "k_proj", "o_proj"],
        lora_dropout   = 0.05,
        bias           = "none",
        task_type      = TaskType.CAUSAL_LM,
    )
    model = get_peft_model(model, lora_config)
    model.print_trainable_parameters()

    # ── wandb Setup ────────────────────────────────────────────────────────────
    if use_wandb:
        try:
            import wandb
            wandb.init(
                project = "talentflow-voice-agent",
                name    = f"sft-lora-{model_size}-v1",
                tags    = ["sft", "lora", "german", "b2b-sales"],
                config  = {
                    "model":        model_name,
                    "lora_rank":    16,
                    "lora_alpha":   32,
                    "quantization": "4bit-nf4",
                },
            )
        except ImportError:
            print("WARNUNG: wandb nicht installiert – Tracking deaktiviert")

    # ── SFT Training ───────────────────────────────────────────────────────────
    sft_config = SFTConfig(
        output_dir                  = str(OUTPUT_DIR / f"sft_{model_size}"),
        num_train_epochs            = 3,
        per_device_train_batch_size = 2,
        gradient_accumulation_steps = 4,
        learning_rate               = 2e-4,
        fp16                        = True,
        logging_steps               = 10,
        eval_strategy               = "epoch",   # ehemals evaluation_strategy (deprecated >= 4.46)
        save_strategy               = "epoch",
        report_to                   = "wandb" if use_wandb else "none",
        run_name                    = f"talentflow-sft-{model_size}",
        max_seq_length              = 2048,
    )

    trainer = SFTTrainer(
        model         = model,
        args          = sft_config,
        train_dataset = Dataset.from_list(train_data),
        eval_dataset  = Dataset.from_list(eval_data),
        tokenizer     = tokenizer,
    )

    print("\nSFT Training startet...")
    trainer.train()

    save_path = OUTPUT_DIR / f"sft_{model_size}" / "final"
    trainer.save_model(str(save_path))
    print(f"\nFine-tuned Modell gespeichert: {save_path}")

    if use_wandb:
        try:
            import wandb
            wandb.finish()
        except ImportError:
            pass


# ─────────────────────────────────────────────────────────────────────────────
# MODUS 3: Inference-Test des trainierten Classifiers
# ─────────────────────────────────────────────────────────────────────────────

def test_classifier() -> None:
    """Testet den trainierten Classifier mit Beispiel-Gesprächs-Snippets."""
    try:
        from transformers import pipeline
    except ImportError:
        print("FEHLER: transformers nicht installiert")
        return

    model_path = OUTPUT_DIR / "grade_classifier" / "final"
    if not model_path.exists():
        print(f"FEHLER: Kein Classifier gefunden unter {model_path}")
        print("   Zuerst trainieren: python gradio/finetune.py --mode classifier")
        return

    clf = pipeline("text-classification", model=str(model_path))

    test_inputs = [
        ("A-Lead erwartet", "USER: 200 Mitarbeiter, 300 Bewerbungen monatlich. ASSISTANT: Ich sehe drei freie Demo-Slots – Dienstag passt?"),
        ("B-Lead erwartet", "USER: Kein Budget momentan. ASSISTANT: Ich schicke Ihnen Unterlagen zur ROI-Berechnung."),
        ("C-Lead erwartet", "USER: Ich bin nicht der Entscheider. ASSISTANT: Kein Problem, können Sie mir den richtigen Ansprechpartner nennen?"),
    ]

    print("Classifier Test-Ergebnisse:")
    print("-" * 55)
    for expected, text in test_inputs:
        result = clf(text[:512])[0]
        match = "OK" if result["label"] == expected.split("-")[0] else "ABWEICHUNG"
        print(f"  [{match}] Erwartet: {expected:<20} | Vorhergesagt: {result['label']} ({result['score']:.0%})")
        print(f"     Input: {text[:70]}...")
    print("-" * 55)


# ─────────────────────────────────────────────────────────────────────────────
# CLI Entry Point
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="TalentFlow Fine-Tuning Pipeline",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Beispiele:
  python gradio/finetune.py --mode classifier          # Classifier trainieren (kein GPU/Token)
  python gradio/finetune.py --mode sft --size small    # SFT 3B (8GB VRAM + HF Token)
  python gradio/finetune.py --mode sft --size large    # SFT 7B (16GB VRAM + HF Token)
  python gradio/finetune.py --mode test                # Trainierten Classifier testen
  python gradio/finetune.py --mode classifier --wandb  # + wandb Tracking
        """,
    )
    parser.add_argument(
        "--mode",
        choices=["classifier", "sft", "test"],
        default="classifier",
        help="classifier: Lead-Grade Klassifier | sft: SFT mit LoRA | test: Classifier testen",
    )
    parser.add_argument(
        "--size",
        choices=["small", "large"],
        default="small",
        help="SFT Modellgröße: small=3B (8GB VRAM) | large=7B (16GB VRAM)",
    )
    parser.add_argument(
        "--wandb",
        action="store_true",
        help="wandb Experiment-Tracking aktivieren",
    )
    args = parser.parse_args()

    print("=" * 60)
    print("TalentFlow – Fine-Tuning Pipeline")
    print("Everlast Consulting Challenge 2026")
    print("=" * 60)
    print()

    if args.mode == "classifier":
        run_classifier_training(use_wandb=args.wandb)
    elif args.mode == "sft":
        run_sft_training(model_size=args.size, use_wandb=args.wandb)
    elif args.mode == "test":
        test_classifier()
    else:
        print(f"FEHLER: Unbekannter Modus: {args.mode}")
        sys.exit(1)
