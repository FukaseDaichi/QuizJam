import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

function App() {
  return (
    <main className="min-h-full flex items-center justify-center bg-slate-50">
      <h1 className="text-4xl font-black text-brand">QuizJam</h1>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
