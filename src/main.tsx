import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import {
  registerClientTool,
  registerToolResult,
} from "@/core/tools/registry";
import { ReadProjectFile } from "@/core/tools/builtins/ReadProjectFile";
import { ReadProjectFileResultCard } from "@/core/tools/builtins/ReadProjectFileResultCard";
import { WriteProjectFile } from "@/core/tools/builtins/WriteProjectFile";
import { WriteProjectFileResultCard } from "@/core/tools/builtins/WriteProjectFileResultCard";
import { EditProjectFile } from "@/core/tools/builtins/EditProjectFile";
import "./styles.css";

// Claude can read / edit / write any file the user uploaded by calling
// these client tools. The handler components live entirely in the
// browser — they look up / mutate ProjectContext.files directly, never
// touching the network. `edit_project_file` reuses the write result
// card because both payloads carry the same diff/size shape.
registerClientTool("read_project_file", ReadProjectFile);
registerToolResult("read_project_file", ReadProjectFileResultCard);
registerClientTool("write_project_file", WriteProjectFile);
registerToolResult("write_project_file", WriteProjectFileResultCard);
registerClientTool("edit_project_file", EditProjectFile);
registerToolResult("edit_project_file", WriteProjectFileResultCard);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
