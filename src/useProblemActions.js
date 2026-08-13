import { useState, useEffect, useRef } from 'react';
import { api } from './api.js';

// Status editing, AC celebration, feedback CRUD, and toasts shared by the
// problem-set and olympiad pages. Operates on the lifted `problems` state so
// progress stays in sync across both pages.
//
// `resolve` is optional: (id) => [problemsArray, setProblemsFn]. When given,
// status updates route to that array instead of `problems` (the Lists page
// spans the ICPC and Codeforces arrays).
export function useProblemActions(problems, setProblems, resolve) {
  const [feedback, setFeedback] = useState({});
  const [feedbackFor, setFeedbackFor] = useState(null);
  const [toast, setToast] = useState(null);
  const [justSolved, setJustSolved] = useState(null);
  const toastTimer = useRef(null);
  const solvedTimer = useRef(null);

  useEffect(() => {
    let cancelled = false;
    api.getFeedback()
      .then((map) => { if (!cancelled) setFeedback(map); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  function showToast(msg, kind) {
    setToast({ msg, kind });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }

  async function updateStatus(id, newStatus) {
    const [list, setList] = resolve ? resolve(id) : [problems, setProblems];
    const prev = list.find((p) => p.id === id);
    const previous = prev?.status || "";
    const previousAt = prev?.statusUpdatedAt || null;
    setList((cur) => cur.map((p) => (
      p.id === id ? { ...p, status: newStatus, statusUpdatedAt: new Date().toISOString() } : p
    )));
    if (newStatus === "AC" && previous !== "AC") {
      setJustSolved(id);
      clearTimeout(solvedTimer.current);
      solvedTimer.current = setTimeout(() => setJustSolved(null), 900);
      showToast("Solved! Nice work 🎉", "success");
    }
    try {
      if (newStatus) await api.setStatus(id, newStatus);
      else await api.clearStatus(id);
    } catch (err) {
      setList((cur) => cur.map((p) => (
        p.id === id ? { ...p, status: previous, statusUpdatedAt: previousAt } : p
      )));
      setJustSolved(null);
      showToast(`Save failed: ${err.message}`, "error");
    }
  }

  async function submitFeedback(category, comment) {
    const id = feedbackFor.id;
    await api.setFeedback(id, category, comment);
    setFeedback((cur) => ({ ...cur, [id]: { category, comment } }));
    setFeedbackFor(null);
    showToast("Thanks for the feedback!", "success");
  }

  async function deleteFeedback() {
    const id = feedbackFor.id;
    await api.deleteFeedback(id);
    setFeedback((cur) => {
      const next = { ...cur };
      delete next[id];
      return next;
    });
    setFeedbackFor(null);
    showToast("Feedback removed", "success");
  }

  return {
    feedback, feedbackFor, setFeedbackFor,
    toast, justSolved,
    updateStatus, submitFeedback, deleteFeedback, showToast,
  };
}
