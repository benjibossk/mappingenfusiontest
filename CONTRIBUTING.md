# Contributing to Reforger Mapper

Thanks for helping! This project is meant to be built by several people: every fix, test report or idea counts.

## Set up

1. Fork the repo, clone your fork.
2. `npm install`, then `npm run dev` (site, http://localhost:5173) and `npm run bridge` (local bridge, port 5780).
3. Copy `workbench/Mapgenerator/` into `Documents/My Games/ArmaReforgerWorkbench/addons/`, add it in the Workbench
   and enable the **NET API** (Workbench > Options, port 5775).

## Make a change

1. Create a branch: `git checkout -b fix/bridge-height`.
2. Keep it small: one fix or one feature per pull request.
3. Check it builds: `npx tsc --noEmit`. If you touched the plugin (`workbench/`), recompile in the Workbench
   (Script Editor > Build > Validate and Reload Scripts) and make sure there are no errors.
4. Open a pull request against `main`: what it changes, how you tested it, and a screenshot if it is visual.

Not sure where to start? Look at the **Known issues** in the README, or open an issue to talk about it first.

## Code style

- TypeScript for the site, Enforce Script for the plugin. Match the code around you: naming, comment density, idioms.
- UI text goes through `t()` with a key in **both** tables of `src/i18n.ts` (English and French).
- Enforce Script has no ternary `? :` and no `%` operator: use `if/else` and `i - (i / n) * n`.
- Vanilla assets only; do not copy code from projects without a compatible licence. Add sources you used to `CREDITS.md`.

## Not a coder?

- Test the tool on your own map and report bugs (what you did, what happened, a screenshot).
- Capture good house / garden parcels from the vanilla maps with the `MapGen - Capture templates` plugin and share them.
- Bench data: FPS per platform (Xbox Series S/X, PS5, PC) for the entity budget.
- Translations and documentation.
