# AI Short Video Factory

## Output Language

Project-facing results must be bilingual: Chinese first, then English. Include frontend, UI interface, backend, content system, packaged render output, and verification when reporting work.

## Commands

```bash
npm run generate -- --topic "AI cartoon fruit drama" --count 5
npm test
npm run build
npm run render
```

## Project Rules

- Keep provider credentials out of tracked files and command output.
- Use mock providers by default so the full pipeline works without paid API access.
- Generated project state belongs in `storage/` and dashboard seed state belongs in `public/factory-state.json`.
- Packaged MP4 renders belong in `outputs/`.
- After frontend edits, run the app and verify the rendered dashboard.
- After backend/rendering edits, run `npm test`, `npm run generate`, and `npm run render`.
