# Brief for the certified translator

Hand this to the translation agency **in writing, before they begin**. The
registration is Arabic-only and carries no English name, so whatever the
translator writes becomes the company's legal English name permanently — on the
Meta Business Manager form, in the legal pages, in the site footer and on every
document that follows. It is a decision, not a transcription, and it is ours to
make rather than theirs.

## Before ordering: one call that may settle it

Ask the **Companies Control Department** whether an English extract or English
name already exists on file for registration **83622**. If it does, that spelling
outranks anything a translator chooses, and the rest of this brief becomes a
matter of matching it exactly. Five minutes, and it removes the risk of two
different English names existing in two different places.

## The source string

```
شركة الحجرة لتقنية المعلومات /ذات مسؤولية محدودة
```

Confirmed 2026-08-26 from the registration PDF's text layer, identical on both
pages. Commercial registration **83622**, national establishment number
**200214930**, registered 30 July 2026, status `قائمة` (active).

## The decision: how `الحجرة` is spelled

| Option | Notes |
|---|---|
| **Al-Hujra** | Most common convention for Jordanian company English names; hyphenated article. **Recommended unless the Department has something on file.** |
| Alhujra | No hyphen. Matches the earlier internal guess, which was otherwise wrong. |
| Al Hujrah | Space, trailing h. |
| Al-Hijra | Different vowel — carries an unrelated meaning. Avoid. |

**Pick one, write it in the instruction, and never vary it afterwards.** Meta
compares the name in Business Manager against the document and requires an exact
match, including hyphens and spacing. `Al-Hujra` and `Al Hujra` are different
strings to a reviewer.

## Instruction to send

> Please produce a certified English translation of the attached commercial
> registration (no. 83622).
>
> Render the company name **exactly** as:
>
> **Al-Hujra Information Technology Company / Limited Liability Company**
>
> Please use this spelling throughout and do not substitute an alternative
> transliteration. The English name must be identical everywhere it appears in
> the translation.
>
> Please keep the registration number, national establishment number, the
> registration date and the listed business activities in the translation, and
> apply the agency's official stamp to the translated document.

*(Replace the bold name if the Department has an English name on file, or if a
different spelling is chosen — but change it in one place, here, before sending.)*

## Why the wording is that shape

- **"Information Technology", not "Technology".** `لتقنية المعلومات` is
  *information* technology. An earlier internal guess dropped "Information" and
  would have produced a name that does not match the document.
- **The activities matter for App Review.** The registration covers website
  design, software development and business applications, which corroborates
  what the app does. Keeping them in the translation gives a Meta reviewer a
  reason to believe the entity and the product belong together.
- **The stamp is on the translation, not the registration.** Our registration is
  deliberately unstamped — its own footer says so, with a QR code for
  verification. The certified translation is where an agency stamp appears.

## After it arrives

1. Set the English name in Meta Business Manager **character for character**.
2. Fill `OPERATOR` and `ADDRESS` in `src/pages/Legal.tsx` with the same string.
3. Add the entity to the site footer with registration number 83622, so the link
   between the brand "The Office" and an Arabic document naming `الحجرة` is
   visible to a non-Arabic reader.
4. Record the final spelling in `docs/PROJECT-STATE.md` §0 so no later session
   reintroduces a variant.
