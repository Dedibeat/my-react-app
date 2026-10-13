// Performance rating of a contest result, ported from analyze_standings' virtual
// calculator (arch_a.elo): place the result in the contest's real final standings,
// find the rating at which the field's expected number of teams ahead equals
// rank - 1, then map that rating to Codeforces points. Data comes from
// scripts/export_contest_fields.py (data/contest_fields/).
//
// A field team row is [name, affiliation, solved, penaltyMinutes, theta, performance, officialRank, event].
// event = 1 marks the contest's own official teams on a board that also lists online mirror entries
// (UCup teams, QOJ accounts). Mirror entries finish well above the same teams onsite, so the analyzer
// ranks an official result among the event's own teams; virtual results use the whole board.

// Cached per session; a failed fetch is forgotten so a later call can retry.
let indexPromise = null;
const fieldPromises = new Map();

function fetchJson(url) {
  return fetch(url).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });
}

export function loadFieldIndex() {
  if (!indexPromise) {
    indexPromise = fetchJson('/contest_fields/index.json').catch((err) => {
      indexPromise = null;
      throw err;
    });
  }
  return indexPromise;
}

export function loadField(contestId) {
  if (!fieldPromises.has(contestId)) {
    fieldPromises.set(contestId, fetchJson(`/contest_fields/${contestId}.json`).catch((err) => {
      fieldPromises.delete(contestId);
      throw err;
    }));
  }
  return fieldPromises.get(contestId);
}

function solveProb(theta, b) {
  return 1 / (1 + 10 ** ((b - theta) / 400));
}

function ratingForRank(thetas, rank, scale) {
  const f = (b) => thetas.reduce((s, th) => s + solveProb(th, b), 0) - (rank - 1);
  let lo = scale.lo;
  let hi = scale.hi;
  if (f(lo) <= 0) return lo;
  if (f(hi) >= 0) return hi;
  while (hi - lo > 1e-4) {
    const m = (lo + hi) / 2;
    if (f(m) > 0) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

function toCf(x, index) {
  const { lo, step, ys } = index.to_cf;
  const v = Math.max(index.scale.lo, Math.min(index.scale.hi, x));
  const pos = (v - lo) / step;
  const i0 = Math.floor(pos);
  const i1 = Math.min(i0 + 1, ys.length - 1);
  return ys[i0] + (ys[i1] - ys[i0]) * (pos - i0);
}

// { rank, of, performance, event } for { kind, solved, penalty, team_name }.
// Official results use the team's own row (the analyzer's performance, and its rank among the rows
// it was ranked against); virtual results, or an official team no longer in the data, are inserted
// into the field. event: the rank counts only the event's own official teams.
export function resultFor(index, field, result) {
  const official = result.kind === 'official';
  const own = official
    && field.teams.find((t) => t[0] === result.team_name && t[2] === result.solved && t[3] === result.penalty);
  const eventTeams = field.teams.filter((t) => t[7]);
  const event = official && eventTeams.length > 0 && (!own || own[7] === 1);
  const teams = event ? eventTeams : field.teams;
  if (own) {
    const rank = event ? teams.filter((t) => t[6] < own[6]).length + 1 : own[6];
    return { rank, of: teams.length, performance: own[5], event };
  }
  const better = teams.filter(
    (t) => t[2] > result.solved || (t[2] === result.solved && t[3] < result.penalty),
  ).length;
  const rank = better + 1;
  const rho = ratingForRank(teams.map((t) => t[4]), rank, index.scale);
  return { rank, of: teams.length + 1, performance: toCf(rho, index), event };
}
