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
import { AppErrorPage } from "./components/AppErrorPage";

const errorElement = <AppErrorPage />;
const router = createBrowserRouter([
  { path: "/", element: <GmTopPage />, errorElement },
  { path: "/gm/:code", element: <GmRoomPage />, errorElement },
  { path: "/play/:code", element: <JoinPage />, errorElement },
  { path: "/play/:code/game", element: <PlayPage />, errorElement },
  { path: "/admin", element: <QuestionSetListPage />, errorElement },
  { path: "/admin/:id", element: <QuestionSetEditPage />, errorElement },
]);

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
