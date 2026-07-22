// Fetches the Keqing (Mistsplitter Reforged, 4p TF) leaderboard from akasha.cv's
// own JSON API and writes the top 20 + GH's build stats + total player count
// to data/leaderboard.json. Runs daily via GitHub Actions (see
// .github/workflows/update-leaderboard.yml) — this is server-side, so it isn't
// subject to browser CORS restrictions the way the app itself would be.

const CALCULATION_ID = "1000004200";
const VARIANT = "tf";
const TRACKED_UID = "602489073"; // GH

const LEADERBOARD_URL =
  `https://akasha.cv/api/leaderboards?sort=calculation.result&order=-1&size=20&page=1` +
  `&filter=&uids=&p=&fromId=&li=&variant=${VARIANT}&calculationId=${CALCULATION_ID}`;

function refinementLabel(value) {
  // akasha reports refinement as a 0-indexed value (0 = R1 ... 4 = R5)
  return `R${(value ?? 0) + 1}`;
}

function primaryArtifactSet(artifactSets) {
  if (!artifactSets) return "";
  const entries = Object.entries(artifactSets);
  if (entries.length === 0) return "";
  // pick the set with the highest piece count (the "real" 4pc set, ignoring
  // a mismatched 1pc/2pc off-piece some builds run)
  entries.sort((a, b) => (b[1].count || 0) - (a[1].count || 0));
  const [name, info] = entries[0];
  return `${name} (${info.count}pc)`;
}

async function main() {
  const res = await fetch(LEADERBOARD_URL);
  if (!res.ok) throw new Error(`Leaderboard fetch failed: ${res.status}`);
  const json = await res.json();
  const rows = json.data || [];

  let totalPlayers = null;
  if (json.totalRowsHash) {
    const sizeRes = await fetch(
      `https://akasha.cv/api/getCollectionSize/?variant=charactersLb&hash=${json.totalRowsHash}`
    );
    if (sizeRes.ok) {
      const sizeJson = await sizeRes.json();
      totalPlayers = sizeJson.totalRows ?? null;
    }
  }

  const top20Rows = rows.slice(0, 20).map((entry, i) => ({
    rank: i + 1,
    nickname: entry.owner?.nickname || "",
    avgDmg: entry.calculation?.result != null ? Math.round(entry.calculation.result) : null,
    cv: entry.critValue != null ? Number(entry.critValue.toFixed(1)) : null,
  }));

  const today = new Date().toISOString().slice(0, 10);

  const trackedEntry = rows.find((e) => e.uid === TRACKED_UID) || rows[0];
  let build = null;
  if (trackedEntry) {
    const s = trackedEntry.stats || {};
    build = {
      weapon: `${trackedEntry.weapon?.name || ""} ${refinementLabel(trackedEntry.weapon?.weaponInfo?.refinementLevel?.value)}`.trim(),
      artifactSet: primaryArtifactSet(trackedEntry.artifactSets),
      critRate: s.critRate ? Number((s.critRate.value * 100).toFixed(1)) : null,
      critDmg: s.critDamage ? Number((s.critDamage.value * 100).toFixed(1)) : null,
      atk: s.atk ? Math.round(s.atk.value) : null,
      dmgBonus: s.electroDamageBonus ? Number((s.electroDamageBonus.value * 100).toFixed(1)) : null,
      avgDmg: trackedEntry.calculation?.result != null ? Math.round(trackedEntry.calculation.result) : null,
    };
  }

  const trackedRank = rows.findIndex((e) => e.uid === TRACKED_UID);

  const output = {
    updatedOn: today,
    fetchedAt: new Date().toISOString(),
    totalPlayers,
    trackedRank: trackedRank >= 0 ? trackedRank + 1 : null,
    build,
    top20: { updatedOn: today, rows: top20Rows },
  };

  const fs = await import("node:fs/promises");
  await fs.mkdir("data", { recursive: true });
  await fs.writeFile("data/leaderboard.json", JSON.stringify(output, null, 2) + "\n");
  console.log("Wrote data/leaderboard.json:", JSON.stringify(output, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
