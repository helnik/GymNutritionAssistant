# GymNutritionAssistant

A private, local dashboard for the **Daily** and **Training** sheets in your Excel tracker. Keep entering data in Excel; the dashboard never modifies the workbook.

## Open the app

Requires a recent Node.js LTS release (22.12+ or 24+).

```powershell
npm ci
npm run dev -- --port 5173 --strictPort
```

Open **http://127.0.0.1:5173/GymNutritionAssistant/**, click **Open Excel**, and select your `.xlsx` workbook. In VS Code, the **Dashboard: start** task also starts the app.

After editing Excel, **save the workbook and select it again** using Open Excel. Reloading the same filename preserves the selected dates. The browser does not automatically monitor your disk. On a browser refresh, select the workbook again.

No CDN, external fonts, analytics, account, upload service or AI API is used. In local mode, the app and its dependencies are served locally; on GitHub Pages, only the website assets are downloaded from GitHub. Selected workbook data stays in browser memory and is never uploaded; only goal settings are stored in local browser storage. The local server binds to loopback, not your network. Do not expose the development server publicly.

## GitHub Pages and future updates

Site: **https://helnik.github.io/GymNutritionAssistant/**

Only the `helnik/GymNutritionAssistant` repository is deployed. Its Vite base path is `/GymNutritionAssistant/`; there is no custom domain, root-site deployment, or change to any other Pages repository.

Every push to `main` automatically runs the [deployment workflow](.github/workflows/deploy-pages.yml): install locked dependencies, run tests, build, and publish **only `dist`** to this repository's Pages environment. Repository Settings > Pages must use **GitHub Actions** as its source. Failed builds/tests do not replace the live site. The Actions tab shows deployment success or failure; a manual workflow run can retry a deployment.

### One-time GitHub setup

1. Open [repository Pages settings](https://github.com/helnik/GymNutritionAssistant/settings/pages).
2. The repository is currently private. GitHub Pages for a private repository requires an eligible paid GitHub plan. Otherwise, make the repository public only if you intend to publish its source code. A private source repository does not automatically make its Pages website private.
3. Under **Build and deployment**, set **Source** to **GitHub Actions**. The workflow already exists; do not generate another one.
4. Open [Actions](https://github.com/helnik/GymNutritionAssistant/actions), select **Deploy GymNutritionAssistant to Pages**, and choose **Run workflow** on `main` if the initial push did not deploy successfully.
5. Wait for both `build` and `deploy` to succeed, then open the site URL above. No custom domain or `gh-pages` branch is needed.

### Publish later changes

Run these commands from the project folder. Deployment happens on pushes to `main`, not on local commits alone.

```powershell
git add <changed-code-files>
git commit -m "Describe the update"
git push origin main
```

Wait for the deployment workflow to finish, then reload the site. Vite gives changed JavaScript/CSS new content-hashed filenames; no service worker is installed. The footer displays the deployed commit's short SHA (`Build abc1234`) so you can verify the exact version. Already-open tabs need a refresh after deployment.

Excel/CSV files, local environment files, dependencies and generated output are ignored by Git. The deployment also rejects tracked workbook/CSV files. Never add personal measurements, exported reports, screenshots of your data, or credentials to the repository. Treat the deployed website as public; source-code visibility follows the repository's settings. Your selected workbook is not published.

## Explore

- **Overview:** weight trend, calories, training frequency, target rate and Friday-Thursday weekly report.
- **Body & nutrition:** weight/waist, calories, macros, protein per kg, body composition and hydration.
- **Training:** recorded best-set strength, relative strength, session volume, duration/sets, and training calendar.
- **Relationships:** eight selectable scatterplots with sample counts, paired observations and qualified correlations.
- **Dates:** inclusive start/end dates; quick ranges are anchored to the workbook's latest date, not today's date.
- **Goal & targets:** lean bulk or fat loss, calories, protein and weekly weight-change reference bounds. Bulk suggestions come from Weekly Review. Switching to fat loss suggests a rate band but does not estimate calorie needs.
- **Print / save PDF:** print the active section with its selected date range. Use the browser's PDF destination to save a report.

## Source format

Keep headers in row 1 and add records below. Additional sheets and columns are ignored.

**Daily** requires `Date`, `Cal`, `Kg`. Optional metrics: `Carbs`, `Protein`, `Fat`, `Body Fat %`, `Fat Mass kg`, `Lean Mass kg`, `Skeletal Muscle kg`, `Body Water %`, `ICW kg`, `ECW kg`, `Waist cm`.

**Training** requires `Date`, `Workout`, `Working sets`, `Load volume kg`. Optional metrics: `Duration min`, `Exercises`, `Total reps`, `Best weighted set`, `Failure sets`.

Use actual Excel dates or ISO `YYYY-MM-DD` strings. Best sets support `Bench Press: 80x10` and `Bench Press 100×8`. Different exercise names are not automatically merged. Workbook limit: 20 MB.

## Interpretation and calculations

- Calculations use source entries, not cached Excel dashboard formulas or Training's nutrition lookup columns.
- Blank values remain missing. An explicitly recorded zero failure count is retained. Missing calendar days are not interpolated.
- Duplicate daily dates stop import so they can be resolved explicitly. Invalid values produce visible import notices. Identical training rows are flagged, not silently deleted.
- Rolling averages use available measurements in the preceding 7 **calendar days**, including context before the selected start date.
- Weight rate compares the first and last 7-day window means, divided by the calendar distance between window centres. It requires a range of at least 14 days and at least 5 weigh-ins in each window.
- Weekly reports use Friday-Thursday. Weekly change requires two complete selected weeks with at least 5 weigh-ins each. Calorie/weight relationships additionally require at least 5 calorie logs in the preceding week.
- Previous-period comparison uses the preceding equal-length calendar range and shows its weight-reading count.
- Estimated 1RM uses Epley (`load * (1 + reps / 30)`) for 2-12 reps. Singles use actual load; higher-rep estimates are excluded. There is only one recorded best exercise per session, not a full set-by-set history.
- Relative strength requires same-day weight; no weight is carried forward.
- Lagged daily comparisons require exact consecutive dates. Both observations must be inside the selected range. Workout spacing/failure comparisons use the same workout label.
- Pearson correlation requires at least 5 valid pairs and variation in both axes. Fewer than 20 pairs are flagged as a small sample. Workout-dependent correlations are withheld while unrelated workouts are mixed. Even larger samples do not establish causality or statistical significance.
- Workload and set totals exclude missing values; they are not direct measures of strength, recovery or muscle growth. Old entries may include warm-ups.
- BIA body-composition estimates are hydration-sensitive and not independent measurements. The app does not infer actual muscle/fat gain, recommend calorie adjustments, or diagnose health conditions.

## Validation and production build

```powershell
npm test
npm run build
npm run preview -- --port 4173 --strictPort
```

An optional integration test verifies a local workbook without bundling its contents into the app or test source:

```powershell
$env:WORKBOOK_PATH = 'C:\Personal\GymNutritionAssistant\your-tracker.xlsx'
npm test
```

The integration test checks import and summary consistency without hardcoding personal measurements. Unit tests use synthetic data.

The production files are in `dist`. Serve them locally using the preview command; do not double-click the source HTML, which requires the JavaScript build tool.
