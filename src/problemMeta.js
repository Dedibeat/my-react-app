export const IMPORTANCE_COLOR = {
  p5: 'hsl(0, 75%, 85%)',
  p4: 'hsl(25, 75%, 85%)',
  p3: 'hsl(50, 75%, 85%)',
  p2: 'hsl(85, 60%, 88%)',
  p1: 'hsl(0, 0%, 92%)',
};

export const getStatusClass = (status) => {
  if (status === "AC") return "status-solved";
  if (status === "No submission" || status === "") return "";
  return "status-unsolved";
};
