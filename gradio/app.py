"""
Gradio – TalentFlow Voice Agent Testinterface
=============================================
Testet die Gesprächslogik des Agents als Text-Chat OHNE Vapi/Telefon.
Ideal für:
  - Prompt-Iterationen ohne Telefonkosten
  - Schnelles Testen neuer Einwand-Szenarien
  - Demo für Reviewer ohne Audio-Setup

Starten: python gradio/app.py
URL:     http://localhost:7860
"""

import os
import json
import re
from pathlib import Path
import gradio as gr
import anthropic
from dotenv import load_dotenv

load_dotenv()

# ── Config ─────────────────────────────────────────────────────────────────────
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
MODEL             = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-5-20250929")
CONFIG_PATH       = Path(__file__).parent.parent / "agent" / "agent-config.json"
PROMPT_PATH       = Path(__file__).parent.parent / "agent" / "system-prompt.md"

# Load agent config & prompt
with open(CONFIG_PATH, encoding="utf-8") as f:
    config = json.load(f)

with open(PROMPT_PATH, encoding="utf-8") as f:
    system_prompt = f.read()

# Remove markdown code blocks from prompt (Gradio-friendly)
system_prompt_clean = re.sub(r"```[\s\S]*?```", "[CODE BLOCK REMOVED]", system_prompt)

client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

# ── BANT+ Score Tracker ────────────────────────────────────────────────────────
INITIAL_STATE = {
    "bant": {"budget": 0, "authority": 0, "need": 0, "timeline": 0, "fit": 0},
    "phases_completed": [],
    "drop_off_phase": None,
    "booked": False,
    "lead_name": None,
    "lead_company": None,
}

def calculate_grade(bant: dict) -> tuple[int, str]:
    total = sum(bant.values())
    grade = "A" if total >= 80 else "B" if total >= 50 else "C"
    return total, grade

def format_bant_display(bant: dict) -> str:
    total, grade = calculate_grade(bant)
    lines = [
        f"**BANT+ Score: {total}/100 → Grade {grade}**",
        "",
        f"💰 Budget:     {bant['budget']}/25",
        f"👤 Authority:  {bant['authority']}/25",
        f"🎯 Need:       {bant['need']}/25",
        f"⏱️ Timeline:   {bant['timeline']}/15",
        f"🏢 Fit (ICP):  {bant['fit']}/10",
    ]
    return "\n".join(lines)

# ── Chat Function ──────────────────────────────────────────────────────────────
def chat(user_message: str, history: list, state: dict) -> tuple:
    """Main chat handler – calls Claude with full conversation history."""
    if not user_message.strip():
        return history, state, format_bant_display(state["bant"])

    # Build messages array for Claude
    messages = []
    for human_msg, assistant_msg in history:
        if human_msg:
            messages.append({"role": "user",      "content": human_msg})
        if assistant_msg:
            messages.append({"role": "assistant", "content": assistant_msg})
    messages.append({"role": "user", "content": user_message})

    # Call Claude
    try:
        response = client.messages.create(
            model=MODEL,
            max_tokens=512,
            system=system_prompt_clean,
            messages=messages,
        )
        assistant_reply = response.content[0].text
    except Exception as e:
        assistant_reply = f"[Fehler: {e}]"

    # Update history
    history.append((user_message, assistant_reply))

    # Heuristic BANT score updates based on keywords in conversation
    combined = (user_message + " " + assistant_reply).lower()
    bant = state["bant"]

    # Budget keywords
    if any(w in combined for w in ["budget", "eur", "kosten", "investition", "euro"]):
        if any(w in combined for w in ["500", "1000", "1500", "eingeplant", "vorhanden"]):
            bant["budget"] = max(bant["budget"], 25)
        elif bant["budget"] == 0:
            bant["budget"] = 12

    # Authority keywords
    if any(w in combined for w in ["entscheider", "geschäftsführer", "ceo", "leiter", "entscheidung"]):
        if any(w in combined for w in ["ich entscheide", "meine entscheidung", "allein"]):
            bant["authority"] = max(bant["authority"], 25)
        elif bant["authority"] == 0:
            bant["authority"] = 12

    # Need keywords
    if any(w in combined for w in ["bewerbungen", "bewerber", "time-to-hire", "vorselektion", "recruiting"]):
        if any(w in combined for w in ["100", "200", "300", "zu viele", "überwältigt", "45", "30 tage"]):
            bant["need"] = max(bant["need"], 25)
        elif bant["need"] == 0:
            bant["need"] = 12

    # Timeline keywords
    if any(w in combined for w in ["monat", "quartal", "q1", "q2", "zeitplan", "wann", "asap", "schnell"]):
        if any(w in combined for w in ["sofort", "asap", "nächsten monat", "dieses quartal"]):
            bant["timeline"] = max(bant["timeline"], 15)
        elif bant["timeline"] == 0:
            bant["timeline"] = 8

    # Fit keywords
    if any(w in combined for w in ["mitarbeiter", "ma", "unternehmen", "firma", "größe"]):
        if any(w in combined for w in ["50", "100", "200", "300", "400", "500"]):
            bant["fit"] = max(bant["fit"], 10)
        elif bant["fit"] == 0:
            bant["fit"] = 5

    # Booking detection
    if any(w in combined for w in ["termin", "demo", "gebucht", "kalender-einladung", "freue mich"]):
        state["booked"] = True

    state["bant"] = bant
    bant_display = format_bant_display(bant)

    return history, state, bant_display

# ── Reset ──────────────────────────────────────────────────────────────────────
def reset_chat():
    return [], INITIAL_STATE.copy(), format_bant_display(INITIAL_STATE["bant"])

# ── Gradio UI ──────────────────────────────────────────────────────────────────
SCENARIOS = {
    "🟢 A-Lead (Idealkunde)": "Hallo, ich habe gerade Ihre Case Study gelesen. Wir haben aktuell enorme Probleme mit unserem Recruiting – fast 300 Bewerbungen pro Monat und unser HR-Team kommt kaum nach. Ich bin der Geschäftsführer und wir haben definitiv Budget dafür eingeplant. Können Sie mir mehr erzählen?",
    "🟡 B-Lead (Interessiert, Einwände)": "Ich habe Ihre Unterlagen gelesen, klingt interessant. Aber ich bin nicht sicher ob das Budget-mäßig für uns passt. Wer wären Sie nochmal?",
    "🔴 C-Lead (Kein Bedarf)": "Ich habe die Case Study gelesen aber ehrlich gesagt haben wir das gerade nicht auf dem Schirm. Wir nutzen schon Personio und sind eigentlich zufrieden.",
    "⚡ Einwand: Datenschutz": "Bevor wir weitermachen – wie ist das mit dem Datenschutz bei Ihnen? Wir sind sehr sensibel was Bewerberdaten angeht, DSGVO und so.",
    "🔄 Einwand: Falscher Ansprechpartner": "Ich glaube ich bin da nicht die richtige Person. Das müssten Sie eigentlich mit unserer HR-Leiterin Frau Wagner besprechen.",
}

with gr.Blocks(title="TalentFlow Voice Agent – Testinterface", theme=gr.themes.Soft()) as demo:
    gr.Markdown("""
    # 🎙️ TalentFlow Voice Agent – Testinterface
    **Everlast Consulting Challenge 2026** | Testet Agent-Logik ohne Vapi-Telefonkosten

    > **Lisa** ist dein B2B Voice Agent für TalentFlow HR SaaS. Teste Gesprächsphasen, Einwände und Buchungslogik direkt im Browser.
    """)

    with gr.Row():
        with gr.Column(scale=3):
            chatbot = gr.Chatbot(
                label="Gespräch mit Lisa (TalentFlow)",
                height=500,
                bubble_full_width=False,
                avatar_images=(None, "🤖"),
            )
            with gr.Row():
                msg_input = gr.Textbox(
                    placeholder="Schreibe als Lead... (z.B. 'Ich habe Ihre Case Study gelesen')",
                    label="Deine Nachricht (als Lead)",
                    scale=4,
                    lines=2,
                )
                send_btn = gr.Button("Senden ▶", variant="primary", scale=1)

            # Scenario starters
            gr.Markdown("**Schnellstart-Szenarien:**")
            with gr.Row():
                for label, msg in SCENARIOS.items():
                    gr.Button(label, size="sm").click(
                        fn=lambda m=msg: m,
                        outputs=msg_input,
                    )

            reset_btn = gr.Button("🔄 Gespräch zurücksetzen", variant="secondary")

        with gr.Column(scale=1):
            gr.Markdown("### 📊 Live BANT+ Score")
            bant_display = gr.Markdown(format_bant_display(INITIAL_STATE["bant"]))

            gr.Markdown("---")
            gr.Markdown("""
            ### ℹ️ Phasen
            1. **Opening** – Begrüßung
            2. **Discovery** – Pain Points
            3. **Value Pitch** – Mehrwert
            4. **Qualification** – BANT+
            5. **Booking** – Demo buchen
            6. **Wrap-up** – Abschluss

            ---
            ### 🎯 Grade-Schwellen
            - **A** ≥ 80 Punkte → Demo buchen
            - **B** ≥ 50 Punkte → Termin anbieten
            - **C** < 50 Punkte → Nurturing
            """)

    # State
    chat_state = gr.State(INITIAL_STATE.copy())

    # Event handlers
    send_btn.click(
        fn=chat,
        inputs=[msg_input, chatbot, chat_state],
        outputs=[chatbot, chat_state, bant_display],
    ).then(fn=lambda: "", outputs=msg_input)

    msg_input.submit(
        fn=chat,
        inputs=[msg_input, chatbot, chat_state],
        outputs=[chatbot, chat_state, bant_display],
    ).then(fn=lambda: "", outputs=msg_input)

    reset_btn.click(
        fn=reset_chat,
        outputs=[chatbot, chat_state, bant_display],
    )

if __name__ == "__main__":
    print("🚀 TalentFlow Voice Agent Testinterface")
    print(f"   Model: {MODEL}")
    print(f"   Config: {CONFIG_PATH}")
    print()
    demo.launch(
        server_name="0.0.0.0",
        server_port=7860,
        share=False,          # set True for public ngrok URL
        show_api=False,
    )
