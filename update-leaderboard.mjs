name: Update leaderboard data

"on":
  schedule:
    # runs once a day at 09:00 UTC — edit the cron expression to change the time
    - cron: "0 9 * * *"
  workflow_dispatch: {} # lets you also trigger it manually from the Actions tab

permissions:
  contents: write

jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - name: Check out repo
        uses: actions/checkout@v4

      - name: Set up Node
        uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Fetch latest leaderboard data
        run: node scripts/update-leaderboard.mjs

      - name: Commit updated data if it changed
        run: |
          git config user.name "leaderboard-bot"
          git config user.email "actions@users.noreply.github.com"
          git add data/leaderboard.json
          if git diff --cached --quiet; then
            echo "No changes to commit."
          else
            git commit -m "Update leaderboard data ($(date -u +%Y-%m-%d))"
            git push
          fi
