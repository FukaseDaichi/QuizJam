import React from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import "./styles.css";
import { JoinPage } from "./player/JoinPage";
import { PlayPage } from "./player/PlayPage";
import { GmTopPage } from "./gm/GmTopPage";
import { GmRoomPage } from "./gm/GmRoomPage";
import { QuestionSetListPage } from "./admin/QuestionSetListPage";
import { QuestionSetEditPage } from "./admin/QuestionSetEditPage";

const router = createBrowserRouter([
  { path: "/", element: <GmTopPage /> },
  { path: "/gm/:code", element: <GmRoomPage /> },
  { path: "/play/:code", element: <JoinPage /> },
  { path: "/play/:code/game", element: <PlayPage /> },
  { path: "/admin", element: <QuestionSetListPage /> },
  { path: "/admin/:id", element: <QuestionSetEditPage /> },
]);

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
