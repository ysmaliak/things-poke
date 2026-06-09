import { asString, appleScriptLibrary, optionalDateExpression, runAppleScript } from "./appleScript.js";

export type ThingsListName = "Inbox" | "Today" | "Anytime" | "Upcoming" | "Someday" | "Logbook" | "Trash";

export interface TodoInput {
  title: string;
  notes?: string;
  tags?: string[];
  list?: ThingsListName;
  project?: string;
  area?: string;
  deadline?: string;
  when?: string;
  reveal?: boolean;
}

export interface ProjectInput {
  title: string;
  notes?: string;
  tags?: string[];
  area?: string;
  deadline?: string;
  when?: string;
  todos?: string[];
  reveal?: boolean;
}

export interface TodoUpdate {
  id: string;
  title?: string;
  notes?: string;
  tags?: string[];
  deadline?: string;
  when?: string;
  status?: "open" | "completed" | "canceled";
}

export interface ProjectUpdate {
  id: string;
  title?: string;
  notes?: string;
  tags?: string[];
  deadline?: string;
  when?: string;
  status?: "open" | "completed" | "canceled";
  area?: string;
}

function parseJson<T>(text: string): T {
  return JSON.parse(text) as T;
}

function tagsText(tags?: string[]): string {
  return tags?.filter(Boolean).join(", ") ?? "";
}

function propertiesRecord(fields: Record<string, string | undefined>): string {
  const entries = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}:${asString(value ?? "")}`);

  return `{${entries.join(", ")}}`;
}

export async function getVersion(): Promise<string> {
  return await runAppleScript(`
tell application "Things3"
  return version
end tell
`);
}

export async function getLists(): Promise<unknown[]> {
  const output = await runAppleScript(`
${appleScriptLibrary}
set rows to {}
tell application "Things3"
  repeat with l in lists
    set end of rows to "{" & "\\"id\\":" & my jsonString(id of l) & "," & "\\"name\\":" & my jsonString(name of l) & "}"
  end repeat
end tell
set oldDelimiters to AppleScript's text item delimiters
set AppleScript's text item delimiters to ","
set jsonText to rows as text
set AppleScript's text item delimiters to oldDelimiters
return "[" & jsonText & "]"
`);
  return parseJson<unknown[]>(output);
}

export async function getTodos(options: {
  list?: ThingsListName;
  project?: string;
  area?: string;
  tag?: string;
  limit?: number;
} = {}): Promise<unknown[]> {
  const limit = Math.max(1, Math.min(options.limit ?? 30, 200));
  const source =
    options.project ? `to dos of project ${asString(options.project)}` :
    options.area ? `to dos of area ${asString(options.area)}` :
    options.tag ? `to dos of tag ${asString(options.tag)}` :
    options.list ? `to dos of list ${asString(options.list)}` :
    "to dos";

  const output = await runAppleScript(`
${appleScriptLibrary}
set rows to {}
tell application "Things3"
  set sourceItems to ${source}
  set itemCount to 0
  repeat with t in sourceItems
    set itemCount to itemCount + 1
    if itemCount is greater than ${limit} then exit repeat
    set end of rows to my taskJson(t)
  end repeat
end tell
set oldDelimiters to AppleScript's text item delimiters
set AppleScript's text item delimiters to ","
set jsonText to rows as text
set AppleScript's text item delimiters to oldDelimiters
return "[" & jsonText & "]"
`);
  return parseJson<unknown[]>(output);
}

export async function searchTodos(query: string, limit = 30): Promise<unknown[]> {
  const safeLimit = Math.max(1, Math.min(limit, 200));
  const output = await runAppleScript(`
${appleScriptLibrary}
set rows to {}
set needle to ${asString(query)}
tell application "Things3"
  set itemCount to 0
  repeat with t in to dos
    set haystack to (name of t & linefeed & notes of t & linefeed & tag names of t)
    if haystack contains needle then
      set itemCount to itemCount + 1
      if itemCount is greater than ${safeLimit} then exit repeat
      set end of rows to my taskJson(t)
    end if
  end repeat
end tell
set oldDelimiters to AppleScript's text item delimiters
set AppleScript's text item delimiters to ","
set jsonText to rows as text
set AppleScript's text item delimiters to oldDelimiters
return "[" & jsonText & "]"
`);
  return parseJson<unknown[]>(output);
}

export async function getProjects(): Promise<unknown[]> {
  const output = await runAppleScript(`
${appleScriptLibrary}
set rows to {}
tell application "Things3"
  repeat with p in projects
    set areaName to ""
    set areaId to ""
    try
      set areaName to name of area of p
      set areaId to id of area of p
    end try
    set dueText to ""
    try
      set dueText to my isoDate(due date of p)
    end try
    set activationText to ""
    try
      set activationText to my isoDate(activation date of p)
    end try
    set end of rows to "{" & ¬
      "\\"id\\":" & my jsonString(id of p) & "," & ¬
      "\\"title\\":" & my jsonString(name of p) & "," & ¬
      "\\"notes\\":" & my jsonString(notes of p) & "," & ¬
      "\\"status\\":" & my jsonString(status of p as text) & "," & ¬
      "\\"tags\\":" & my jsonString(tag names of p) & "," & ¬
      "\\"deadline\\":" & my jsonString(dueText) & "," & ¬
      "\\"when\\":" & my jsonString(activationText) & "," & ¬
      "\\"areaId\\":" & my jsonString(areaId) & "," & ¬
      "\\"area\\":" & my jsonString(areaName) & "," & ¬
      "\\"todoCount\\":" & (count of to dos of p as text) & ¬
    "}"
  end repeat
end tell
set oldDelimiters to AppleScript's text item delimiters
set AppleScript's text item delimiters to ","
set jsonText to rows as text
set AppleScript's text item delimiters to oldDelimiters
return "[" & jsonText & "]"
`);
  return parseJson<unknown[]>(output);
}

export async function getAreas(): Promise<unknown[]> {
  const output = await runAppleScript(`
${appleScriptLibrary}
set rows to {}
tell application "Things3"
  repeat with a in areas
    set end of rows to "{" & ¬
      "\\"id\\":" & my jsonString(id of a) & "," & ¬
      "\\"name\\":" & my jsonString(name of a) & "," & ¬
      "\\"tags\\":" & my jsonString(tag names of a) & "," & ¬
      "\\"collapsed\\":" & my jsonBool(collapsed of a) & "," & ¬
      "\\"todoCount\\":" & (count of to dos of a as text) & ¬
    "}"
  end repeat
end tell
set oldDelimiters to AppleScript's text item delimiters
set AppleScript's text item delimiters to ","
set jsonText to rows as text
set AppleScript's text item delimiters to oldDelimiters
return "[" & jsonText & "]"
`);
  return parseJson<unknown[]>(output);
}

export async function getTags(): Promise<unknown[]> {
  const output = await runAppleScript(`
${appleScriptLibrary}
set rows to {}
tell application "Things3"
  repeat with t in tags
    set parentName to ""
    set parentId to ""
    try
      set parentName to name of parent tag of t
      set parentId to id of parent tag of t
    end try
    set shortcutText to ""
    try
      set shortcutText to keyboard shortcut of t
    end try
    set end of rows to "{" & ¬
      "\\"id\\":" & my jsonString(id of t) & "," & ¬
      "\\"name\\":" & my jsonString(name of t) & "," & ¬
      "\\"parentId\\":" & my jsonString(parentId) & "," & ¬
      "\\"parent\\":" & my jsonString(parentName) & "," & ¬
      "\\"keyboardShortcut\\":" & my jsonString(shortcutText) & "," & ¬
      "\\"todoCount\\":" & (count of to dos of t as text) & ¬
    "}"
  end repeat
end tell
set oldDelimiters to AppleScript's text item delimiters
set AppleScript's text item delimiters to ","
set jsonText to rows as text
set AppleScript's text item delimiters to oldDelimiters
return "[" & jsonText & "]"
`);
  return parseJson<unknown[]>(output);
}

export async function createTodo(input: TodoInput): Promise<unknown> {
  const props = propertiesRecord({
    name: input.title,
    notes: input.notes,
    "tag names": input.tags ? tagsText(input.tags) : undefined,
  });
  const destination =
    input.project ? ` at beginning of project ${asString(input.project)}` :
    input.area ? ` at beginning of area ${asString(input.area)}` :
    ` at beginning of list ${asString(input.list ?? "Inbox")}`;

  const output = await runAppleScript(`
${appleScriptLibrary}
tell application "Things3"
  set newToDo to make new to do with properties ${props}${destination}
  set deadlineDate to ${optionalDateExpression(input.deadline)}
  if deadlineDate is not missing value then set due date of newToDo to deadlineDate
  set scheduleDate to ${optionalDateExpression(input.when)}
  if scheduleDate is not missing value then schedule newToDo for scheduleDate
  if ${input.reveal ? "true" : "false"} then show newToDo
  return my taskJson(newToDo)
end tell
`);
  return parseJson<unknown>(output);
}

export async function createProject(input: ProjectInput): Promise<unknown> {
  const props = propertiesRecord({
    name: input.title,
    notes: input.notes,
    "tag names": input.tags ? tagsText(input.tags) : undefined,
  });

  const todoLines = (input.todos ?? [])
    .map((title) => `make new to do with properties {name:${asString(title)}} at end of newProject`)
    .join("\n  ");

  const output = await runAppleScript(`
${appleScriptLibrary}
tell application "Things3"
  set newProject to make new project with properties ${props}
  ${input.area ? `set area of newProject to area ${asString(input.area)}` : ""}
  set deadlineDate to ${optionalDateExpression(input.deadline)}
  if deadlineDate is not missing value then set due date of newProject to deadlineDate
  set scheduleDate to ${optionalDateExpression(input.when)}
  if scheduleDate is not missing value then schedule newProject for scheduleDate
  ${todoLines}
  if ${input.reveal ? "true" : "false"} then show newProject
  return my taskJson(newProject)
end tell
`);
  return parseJson<unknown>(output);
}

export async function createArea(name: string, tags?: string[]): Promise<unknown> {
  const props = propertiesRecord({
    name,
    "tag names": tags ? tagsText(tags) : undefined,
  });
  const output = await runAppleScript(`
${appleScriptLibrary}
tell application "Things3"
  set newArea to make new area with properties ${props}
  return "{" & "\\"id\\":" & my jsonString(id of newArea) & "," & "\\"name\\":" & my jsonString(name of newArea) & "," & "\\"tags\\":" & my jsonString(tag names of newArea) & "}"
end tell
`);
  return parseJson<unknown>(output);
}

export async function createTag(name: string, parent?: string): Promise<unknown> {
  const output = await runAppleScript(`
${appleScriptLibrary}
tell application "Things3"
  set newTag to make new tag with properties {name:${asString(name)}}
  ${parent ? `set parent tag of newTag to tag ${asString(parent)}` : ""}
  set parentName to ""
  set parentId to ""
  try
    set parentName to name of parent tag of newTag
    set parentId to id of parent tag of newTag
  end try
  return "{" & "\\"id\\":" & my jsonString(id of newTag) & "," & "\\"name\\":" & my jsonString(name of newTag) & "," & "\\"parentId\\":" & my jsonString(parentId) & "," & "\\"parent\\":" & my jsonString(parentName) & "}"
end tell
`);
  return parseJson<unknown>(output);
}

export async function updateTodo(input: TodoUpdate): Promise<unknown> {
  const output = await runAppleScript(`
${appleScriptLibrary}
tell application "Things3"
  set targetToDo to my findTodoById(${asString(input.id)})
  ${input.title !== undefined ? `set name of targetToDo to ${asString(input.title)}` : ""}
  ${input.notes !== undefined ? `set notes of targetToDo to ${asString(input.notes)}` : ""}
  ${input.tags !== undefined ? `set tag names of targetToDo to ${asString(tagsText(input.tags))}` : ""}
  ${input.status !== undefined ? `set status of targetToDo to ${input.status}` : ""}
  set deadlineDate to ${optionalDateExpression(input.deadline)}
  if deadlineDate is not missing value then set due date of targetToDo to deadlineDate
  set scheduleDate to ${optionalDateExpression(input.when)}
  if scheduleDate is not missing value then schedule targetToDo for scheduleDate
  return my taskJson(targetToDo)
end tell
`);
  return parseJson<unknown>(output);
}

export async function updateProject(input: ProjectUpdate): Promise<unknown> {
  const output = await runAppleScript(`
${appleScriptLibrary}
tell application "Things3"
  set targetProject to my findProjectById(${asString(input.id)})
  ${input.title !== undefined ? `set name of targetProject to ${asString(input.title)}` : ""}
  ${input.notes !== undefined ? `set notes of targetProject to ${asString(input.notes)}` : ""}
  ${input.tags !== undefined ? `set tag names of targetProject to ${asString(tagsText(input.tags))}` : ""}
  ${input.status !== undefined ? `set status of targetProject to ${input.status}` : ""}
  ${input.area !== undefined ? `set area of targetProject to area ${asString(input.area)}` : ""}
  set deadlineDate to ${optionalDateExpression(input.deadline)}
  if deadlineDate is not missing value then set due date of targetProject to deadlineDate
  set scheduleDate to ${optionalDateExpression(input.when)}
  if scheduleDate is not missing value then schedule targetProject for scheduleDate
  return my taskJson(targetProject)
end tell
`);
  return parseJson<unknown>(output);
}

export async function moveTodo(input: { id: string; list?: ThingsListName; project?: string; area?: string }): Promise<unknown> {
  const action =
    input.project ? `set project of targetToDo to project ${asString(input.project)}` :
    input.area ? `set area of targetToDo to area ${asString(input.area)}` :
    input.list ? `move targetToDo to list ${asString(input.list)}` :
    `error "Provide list, project, or area"`;

  const output = await runAppleScript(`
${appleScriptLibrary}
tell application "Things3"
  set targetToDo to my findTodoById(${asString(input.id)})
  ${action}
  return my taskJson(targetToDo)
end tell
`);
  return parseJson<unknown>(output);
}

export async function deleteTodo(id: string): Promise<string> {
  return await runAppleScript(`
${appleScriptLibrary}
tell application "Things3"
  set targetToDo to my findTodoById(${asString(id)})
  delete targetToDo
  return "Moved to-do to Trash: ${id}"
end tell
`);
}

export async function deleteProject(id: string): Promise<string> {
  return await runAppleScript(`
${appleScriptLibrary}
tell application "Things3"
  set targetProject to my findProjectById(${asString(id)})
  delete targetProject
  return "Moved project to Trash: ${id}"
end tell
`);
}

export async function deleteArea(id: string): Promise<string> {
  return await runAppleScript(`
${appleScriptLibrary}
tell application "Things3"
  set targetArea to my findAreaById(${asString(id)})
  delete targetArea
  return "Deleted area: ${id}"
end tell
`);
}

export async function deleteTag(id: string): Promise<string> {
  return await runAppleScript(`
${appleScriptLibrary}
tell application "Things3"
  set targetTag to my findTagById(${asString(id)})
  delete targetTag
  return "Deleted tag: ${id}"
end tell
`);
}

export async function showItem(input: { type: "todo" | "project" | "area" | "list"; id?: string; name?: string }): Promise<string> {
  const target =
    input.type === "todo" && input.id ? `my findTodoById(${asString(input.id)})` :
    input.type === "project" && input.id ? `my findProjectById(${asString(input.id)})` :
    input.type === "project" && input.name ? `project ${asString(input.name)}` :
    input.type === "area" && input.id ? `my findAreaById(${asString(input.id)})` :
    input.type === "area" && input.name ? `area ${asString(input.name)}` :
    input.type === "list" && input.name ? `list ${asString(input.name)}` :
    undefined;
  if (!target) {
    throw new Error("Provide a valid id or name for the requested Things item type.");
  }

  return await runAppleScript(`
${appleScriptLibrary}
tell application "Things3"
  show ${target}
  return "Shown in Things"
end tell
`);
}

export async function editTodo(id: string): Promise<string> {
  return await runAppleScript(`
${appleScriptLibrary}
tell application "Things3"
  edit my findTodoById(${asString(id)})
  return "Opened to-do for editing in Things"
end tell
`);
}

export async function quickEntry(input: { title?: string; notes?: string; tags?: string[]; deadline?: string; autofill?: boolean }): Promise<string> {
  const props = propertiesRecord({
    name: input.title,
    notes: input.notes,
    "tag names": input.tags ? tagsText(input.tags) : undefined,
  });
  return await runAppleScript(`
tell application "Things3"
  ${input.autofill ? "show quick entry panel with autofill yes" : `show quick entry panel with properties ${props}`}
  return "Opened Things Quick Entry"
end tell
`);
}

export async function searchInThings(query: string): Promise<string> {
  const url = `things:///search?query=${encodeURIComponent(query)}`;
  return await runAppleScript(`
do shell script "open " & quoted form of ${asString(url)}
return "Opened Things search"
`);
}

export async function logCompletedNow(): Promise<string> {
  return await runAppleScript(`
tell application "Things3"
  log completed now
  return "Logged completed Things items"
end tell
`);
}

export async function emptyTrash(): Promise<string> {
  return await runAppleScript(`
tell application "Things3"
  empty trash
  return "Emptied Things trash"
end tell
`);
}
