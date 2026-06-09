import { spawn } from "node:child_process";
export async function runAppleScript(script, options = {}) {
    const timeoutMs = options.timeoutMs ?? 20_000;
    return await new Promise((resolve, reject) => {
        const child = spawn("osascript", ["-"], {
            stdio: ["pipe", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        const timer = setTimeout(() => {
            child.kill("SIGKILL");
            reject(new Error(`AppleScript timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
            stdout += chunk;
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk;
        });
        child.on("error", (error) => {
            clearTimeout(timer);
            reject(error);
        });
        child.on("close", (code) => {
            clearTimeout(timer);
            if (code === 0) {
                resolve(stdout.trim());
                return;
            }
            reject(new Error(stderr.trim() || `osascript exited with code ${code}`));
        });
        child.stdin.end(script);
    });
}
export function asString(value) {
    return `"${value
        .replaceAll("\\", "\\\\")
        .replaceAll("\"", "\\\"")
        .replaceAll("\r", "\\r")
        .replaceAll("\n", "\\n")}"`;
}
export function optionalDateExpression(value) {
    if (!value) {
        return "missing value";
    }
    return `my dateFromISO(${asString(value)})`;
}
export const appleScriptLibrary = String.raw `
on replaceText(findText, replaceText, sourceText)
  set oldDelimiters to AppleScript's text item delimiters
  set AppleScript's text item delimiters to findText
  set textItems to text items of sourceText
  set AppleScript's text item delimiters to replaceText
  set joinedText to textItems as text
  set AppleScript's text item delimiters to oldDelimiters
  return joinedText
end replaceText

on jsonEscape(sourceValue)
  if sourceValue is missing value then return ""
  set sourceText to sourceValue as text
  set sourceText to my replaceText("\\", "\\\\", sourceText)
  set sourceText to my replaceText("\"", "\\\"", sourceText)
  set sourceText to my replaceText(linefeed, "\\n", sourceText)
  set sourceText to my replaceText(return, "\\n", sourceText)
  set sourceText to my replaceText(tab, "\\t", sourceText)
  return sourceText
end jsonEscape

on jsonString(sourceValue)
  return "\"" & my jsonEscape(sourceValue) & "\""
end jsonString

on jsonBool(sourceValue)
  if sourceValue then
    return "true"
  end if
  return "false"
end jsonBool

on pad2(n)
  set nText to n as integer as text
  if length of nText is 1 then return "0" & nText
  return nText
end pad2

on isoDate(d)
  if d is missing value then return ""
  try
    set y to year of d as integer
    set m to month of d as integer
    set dayNumber to day of d as integer
    set h to hours of d as integer
    set minNumber to minutes of d as integer
    set secNumber to seconds of d as integer
    return (y as text) & "-" & my pad2(m) & "-" & my pad2(dayNumber) & "T" & my pad2(h) & ":" & my pad2(minNumber) & ":" & my pad2(secNumber)
  on error
    return d as text
  end try
end isoDate

on dateFromISO(sourceText)
  if sourceText is "" then return missing value
  set cleanText to sourceText as text
  set y to text 1 thru 4 of cleanText as integer
  set m to text 6 thru 7 of cleanText as integer
  set d to text 9 thru 10 of cleanText as integer
  set resultDate to current date
  set year of resultDate to y
  set month of resultDate to m
  set day of resultDate to d
  set time of resultDate to 0
  if length of cleanText is greater than or equal to 16 then
    set h to text 12 thru 13 of cleanText as integer
    set minNumber to text 15 thru 16 of cleanText as integer
    set time of resultDate to (h * hours) + (minNumber * minutes)
  end if
  return resultDate
end dateFromISO

on taskJson(t)
  tell application "Things3"
    set projectName to ""
    set projectId to ""
    set areaName to ""
    set areaId to ""
    try
      set projectName to name of project of t
      set projectId to id of project of t
    end try
    try
      set areaName to name of area of t
      set areaId to id of area of t
    end try

    set dueText to ""
    try
      set dueText to my isoDate(due date of t)
    end try
    set activationText to ""
    try
      set activationText to my isoDate(activation date of t)
    end try
    set completionText to ""
    try
      set completionText to my isoDate(completion date of t)
    end try
    set cancellationText to ""
    try
      set cancellationText to my isoDate(cancellation date of t)
    end try

    return "{" & ¬
      "\"id\":" & my jsonString(id of t) & "," & ¬
      "\"title\":" & my jsonString(name of t) & "," & ¬
      "\"notes\":" & my jsonString(notes of t) & "," & ¬
      "\"status\":" & my jsonString(status of t as text) & "," & ¬
      "\"tags\":" & my jsonString(tag names of t) & "," & ¬
      "\"deadline\":" & my jsonString(dueText) & "," & ¬
      "\"when\":" & my jsonString(activationText) & "," & ¬
      "\"completedAt\":" & my jsonString(completionText) & "," & ¬
      "\"canceledAt\":" & my jsonString(cancellationText) & "," & ¬
      "\"projectId\":" & my jsonString(projectId) & "," & ¬
      "\"project\":" & my jsonString(projectName) & "," & ¬
      "\"areaId\":" & my jsonString(areaId) & "," & ¬
      "\"area\":" & my jsonString(areaName) & ¬
    "}"
  end tell
end taskJson

on listJson(listItems)
  set jsonItems to {}
  repeat with anItem in listItems
    set end of jsonItems to my taskJson(anItem)
  end repeat
  set oldDelimiters to AppleScript's text item delimiters
  set AppleScript's text item delimiters to ","
  set jsonText to jsonItems as text
  set AppleScript's text item delimiters to oldDelimiters
  return "[" & jsonText & "]"
end listJson

on findTodoById(todoId)
  tell application "Things3"
    repeat with t in to dos
      if id of t is todoId then return t
    end repeat
  end tell
  error "No Things to-do found with id " & todoId
end findTodoById

on findProjectById(projectId)
  tell application "Things3"
    repeat with p in projects
      if id of p is projectId then return p
    end repeat
  end tell
  error "No Things project found with id " & projectId
end findProjectById

on findAreaById(areaId)
  tell application "Things3"
    repeat with a in areas
      if id of a is areaId then return a
    end repeat
  end tell
  error "No Things area found with id " & areaId
end findAreaById

on findTagById(tagId)
  tell application "Things3"
    repeat with t in tags
      if id of t is tagId then return t
    end repeat
  end tell
  error "No Things tag found with id " & tagId
end findTagById
`;
