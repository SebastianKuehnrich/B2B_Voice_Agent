# Trainingsdaten – Deutsche Telefongesprächs-Datasets

Recherchiert: 2026-02-28 | Quelle: HuggingFace + WebSearch

---

## Gefundene Datasets (nach Relevanz sortiert)

### 🥇 1. `AxonData/german-contact-center-conversation-dataset`
**Relevanz für unser Projekt: 5/5**
- **URL:** https://huggingface.co/datasets/AxonData/german-contact-center-conversation-dataset
- **Inhalt:** 1.000+ Stunden reale deutsche Call-Center-Gespräche mit Transkripten
- **Format:** Audio + Transkripte, Telefon-Qualität (8kHz)
- **Anwendung:** STT-Feinabstimmung, Sentiment-Analyse, direkt nutzbar für deutsche Telefon-Kontext-Erkennung
- **Lizenz:** Prüfen – AxonData ist kommerziell, Lizenz vor Nutzung verifizieren
- **Notiz:** Closest match – echter Telefon-Kontext auf Deutsch

---

### 🥈 2. `AxonData/multilingual-call-center-speech-dataset`
**Relevanz: 4/5**
- **URL:** https://huggingface.co/datasets/AxonData/multilingual-call-center-speech-dataset
- **Inhalt:** 10.000 Stunden Call-Center-Sprache in 7 Sprachen inkl. Deutsch
- **Format:** Mono Audio 8kHz + Transkripte
- **Anwendung:** Whisper-Fine-Tuning für Telefon-Akustik, sehr groß, guter Baseline-Datensatz
- **Lizenz:** Prüfen

---

### 🥉 3. `DeepMostInnovations/saas-sales-conversations`
**Relevanz: 4/5**
- **URL:** https://huggingface.co/datasets/DeepMostInnovations/saas-sales-conversations
- **Inhalt:** Synthetische SaaS-Verkaufsgespräche (englisch), basierend auf Paper "SalesRLAgent" (2025)
- **Format:** Text-Dialoge mit Conversion-Labels und Engagement-Metriken
- **Anwendung:** Fine-Tuning der Gesprächslogik (muss übersetzt/adaptiert werden)
- **Lizenz:** Offen (synthetisch generiert)
- **Notiz:** Englisch! Muss mit GPT-4o / Claude auf Deutsch übersetzt werden → synthetische DE-Variante erzeugen

---

### 4. `talkbank/callhome`
**Relevanz: 3/5**
- **URL:** https://huggingface.co/datasets/talkbank/callhome
- **Inhalt:** Unscripted Telefongespräche zwischen Native Speakers, inkl. Deutsch-Teilkorpus
- **Format:** Audio + Transkripte
- **Anwendung:** Natürliche Gesprächsdynamik, Interruptions, echte Sprachmuster
- **Lizenz:** Akademisch – Nutzung für Forschung OK

---

### 5. `ud-nlp/german-speech-recognition-dataset` / `UniDataPro/german-speech-recognition-dataset`
**Relevanz: 3/5**
- **URL:** https://huggingface.co/datasets/ud-nlp/german-speech-recognition-dataset
- **Inhalt:** 431 Stunden Telefon-Dialoge Deutsch, 590+ Native Speaker
- **Format:** Audio + Transkripte, 95% Sentence Accuracy
- **Anwendung:** Whisper-Fine-Tuning für Deepgram-Alternative, gute Baseline für deutsche Spracherkennung

---

### 6. `Nexdata/German_Speech_Data_by_Mobile_Phone`
**Relevanz: 3/5**
- **URL:** https://huggingface.co/datasets/Nexdata/German_Speech_Data_by_Mobile_Phone
- **Inhalt:** Deutsches Sprachdata aufgenommen via Mobiltelefon
- **Format:** Audio
- **Anwendung:** Telefon-Akustik-Training, realistisches Rauschprofil

---

## Empfohlene Strategie für unser Projekt

### Phase 1: Synthetische Daten generieren (sofort möglich)
Da echte B2B-Sales-Daten auf Deutsch kaum verfügbar sind:

1. **`DeepMostInnovations/saas-sales-conversations`** laden (englisch)
2. Mit Claude/GPT-4o ins Deutsche übersetzen + auf HR-SaaS-Kontext anpassen
3. Ziel: ~500 Gesprächspaare (Frage-Antwort-Paare für alle 6 Phasen)

### Phase 2: Fine-Tuning Pipeline
```python
# In gradio/finetune.py (TODO)
from datasets import load_dataset
from transformers import AutoModelForCausalLM
from trl import SFTTrainer, SFTConfig
from peft import LoraConfig

# Dataset laden
dataset = load_dataset("DeepMostInnovations/saas-sales-conversations")

# LoRA Fine-Tuning auf kleinem Open-Source Modell
# (für Classifier: Lead Grade A/B/C aus Gesprächs-Snippet)
```

### Phase 3: Evaluierung mit wandb (wenn Fine-Tuning startet)
Erst dann lohnt sich wandb – für Loss-Kurven, Hyperparameter-Tracking und Modell-Vergleiche.

---

## Was wir NICHT brauchen (jetzt)
- wandb: Nur wenn wir wirklich trainieren → kein Overhead jetzt
- Vollständiges Audio-Fine-Tuning von Deepgram/Whisper → nicht im Scope der Challenge
- > 1.000 echte Gesprächsbeispiele → für Challenge reichen synthetische Daten

---

## Kurzlink für Browser-Recherche
Direkt auf HuggingFace suchen:
- https://huggingface.co/datasets?search=german+call+center
- https://huggingface.co/datasets?search=sales+dialogue+german
- https://huggingface.co/datasets?search=german+telephone+conversation
