# OncoCarta: a one-page guide for clinicians

## What it is, and what it is not
OncoCarta helps you find the NCCN recommendation that fits your patient, and shows you the NCCN page it came from so you can check it.

It is a **research prototype**. It is **not an official NCCN tool**, and NCCN has not reviewed it. The rules that connect a patient's answers to a recommendation were drafted by software and have not been reviewed by clinicians, so it can be wrong. **Always verify on the NCCN page** before you act, and use your own clinical judgment.

## Five steps to a recommendation
1. **Pick the guideline.** Type a cancer or topic ("Which cancer or topic?"), choose the guideline, then choose **Find a recommendation for a patient**.
2. **Say where the patient is now.** In the **Patient** tab choose New diagnosis, Follow-up, Recurrence or relapse, and so on. If you are not sure, choose Not sure.
3. **Answer the questions.** You see only the questions that change the recommendation, one at a time (or all together as a form). You can also **paste a note** and check what it found. Skip anything you do not know; nothing is required.
4. **Read the recommendation.** Open the **Recommendation** tab. The card shows the best match, what NCCN recommends, why, and what is still unknown. Other possible recommendations are listed below it.
5. **Check it on the NCCN page.** Press **Verify on the NCCN page**.

## Checking a step on the NCCN page
On the diagram, **hover** over any step to preview the NCCN page it came from, with the step highlighted. **Click** the step to open that page in its own window. The footnotes, evidence and preference categories are in the tabs under the diagram. If the page preview is missing, press **Connect the NCCN PDF** and choose your copy of the NCCN guideline; it stays in your browser.

## What the labels mean
- **Best match / Also possible / Less likely**: how well the recommendation fits the answers so far. This is a ranking, **not a probability**.
- **Matches your answers**: shown only on the top recommendation, when your answers decided it and nothing is missing. Other options that also fit say **Also fits your answers**.
- **One of N possible recommendations**: several options fit your answers equally; the guideline does not choose between them, so read them all (NCCN-preferred options are listed first).
- **Possible starting point**: none of your answers decided this yet; answer the questions to narrow it down.
- **Answer these to reach a recommendation**: the answers so far stop before any recommendation; the listed questions are the ones needed next.
- **Why** lists the answers that decided the recommendation, then any answers you entered that were **not used** for it.
- **Needs N more answers**: N answers could still change or confirm this recommendation. The names are listed under **Still unknown**; select one to answer it.
- **Your clinical judgment needed here**: the guideline branches at this point, but OncoCarta cannot decide for you. Use your own judgment and read the NCCN page.
- **Carried over from diagnosis**: when you move a patient from a new diagnosis to a later point in care, answers that described the patient at diagnosis are held aside and do not affect the recommendation until you mark each one **Still true**, change it or clear it.

## How we got here: the decisions behind a recommendation
Under the recommendation card, **How we got here** sums up the decisions on the way, for example *7 decisions · 5 by the guideline rules · 2 by AI (lowest 86%) · 0 by you*. Select it to open the list. Each decision shows its question and **every** option, with a bar and a badge that says where the answer came from:
- **Rule ✓** or **Rule ✗**: the guideline's own condition, checked against your answers, is met or not met. A rule always wins.
- **AI 92%**: the answers did not settle this step, so the AI scored the options and the highest one, at least as confident as your threshold, was followed. The percentage is the AI's confidence, not a clinical probability.
- **You chose**: you picked the option yourself.

The option that was followed is highlighted. **Choose this instead** follows another option and recalculates everything after it; **Take back my choice** undoes it. **Show on NCCN page** opens the page for that option. Your choices are kept with the patient and cleared when you start over; a choice is dropped by itself when a change to the answers means the route no longer passes that step.

If a rule and the AI disagree, the step says so (*The AI favoured 'X' (91%); the guideline rule was followed.*): check it on the NCCN page.

When a step cannot be settled, the tab shows a prominent card: **Your decision needed: ...** lists the options, most confident first, with a **Choose** button on each; **Not enough information to decide ...** lists the details that would settle it, and selecting one takes you to that question. If the AI could not be reached, a grey line says **AI scoring unavailable** and the rules are shown on their own.

On the diagram, the arrow leaving each of these decisions on the recommended route carries a small label (the AI's percentage, **Rule** or **You**); a dashed arrow is one the AI was less sure about than your threshold.

## AI decision support (optional)
AI help appears only when OncoCarta is opened through the local server (see `built/README.md`) with an OpenAI key set; a plain file, or a hosted copy, shows nothing about it. In **Settings → AI decision support** you can turn it off and set the threshold (*Follow the AI automatically when it is at least 85% confident*; from 50% to 99%). Below the threshold the AI never chooses for you: it asks. **The AI never overrides a guideline rule**: it only helps where the patient's answers leave a branch open. In a test on 300 branches where the rules gave the right answer, following the AI at 85% was right 99.5% of the time and covered 70% of branches (`reports/ai-decisions-eval.md`); that is a measure of agreement with the encoded rules, not proof that it is right for a real patient, so check the NCCN page.

**What is sent.** With AI on, the patient's structured answers and the guideline page text are sent to OpenAI to score branches. No names or free text are sent: notes you paste stay in your browser. Check your organisation's data agreements with OpenAI (for example zero data retention) before using real patient data; use made-up cases until then.

## Saving and printing
**Summary to copy or print** (on the recommendation card) gives a one-page record: the answers, the recommendation, what is still unknown and the steps on the way, with the disclaimer. Choose **Copy as text** or **Print**. **More → Save this patient** (Patient tab) keeps the answers for later; use a label such as "Example A", not the patient's name.

## Privacy
Everything runs in your browser. Nothing you type or paste is sent anywhere, **unless** you open OncoCarta through the local server and leave AI decision support on (see above): then the structured answers and the guideline page text are sent to OpenAI to score branches, and never names or free text. Saved patients and connected PDFs stay in this browser on this computer; clearing the browser's site data deletes them. Anyone who uses the same browser profile can see them.

## Problems and questions
If a recommendation looks wrong, or a step does not match its NCCN page, please report it with the guideline name, the page code (for example PROS-3) and what you expected. Tell whoever gave you this copy, or open an issue at https://github.com/davidchen0420/NCCN-Guideline. Do not include patient information.

*The "Settings" gear at the bottom left has Advanced tools, which add reviewer views (scores, other paths, a step-by-step walk). You do not need them to find a recommendation.*
