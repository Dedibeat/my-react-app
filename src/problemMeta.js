export const IMPORTANCE_COLOR = {
  p5: 'hsl(0, 75%, 85%)',
  p4: 'hsl(25, 75%, 85%)',
  p3: 'hsl(50, 75%, 85%)',
  p2: 'hsl(85, 60%, 88%)',
  p1: 'hsl(0, 0%, 92%)',
};

// Olympiad-Combinatorics technique categories (id prefix before the first '-').
export const TECHNIQUE_CATEGORY = {
  ALGO: 'hsl(210, 70%, 88%)',
  GRPH: 'hsl(150, 55%, 86%)',
  PROC: 'hsl(265, 55%, 90%)',
  GAME: 'hsl(0, 70%, 88%)',
  CNT: 'hsl(40, 80%, 86%)',
  EXST: 'hsl(180, 50%, 86%)',
  EXTR: 'hsl(320, 55%, 90%)',
  PROB: 'hsl(95, 50%, 87%)',
};

export const techniqueCategory = (id) => (id || '').split('-')[0];

export const getStatusClass = (status) => {
  if (status === "AC") return "status-solved";
  if (status === "No submission" || status === "") return "";
  return "status-unsolved";
};
