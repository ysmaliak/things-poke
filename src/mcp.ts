import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import {
  createArea,
  createProject,
  createTag,
  createTodo,
  deleteArea,
  deleteProject,
  deleteTag,
  deleteTodo,
  editTodo,
  emptyTrash,
  getAreas,
  getLists,
  getProjects,
  getTags,
  getTodos,
  getVersion,
  logCompletedNow,
  moveTodo,
  quickEntry,
  searchInThings,
  searchTodos,
  showItem,
  updateProject,
  updateTodo,
} from "./things.js";

const listName = z.enum(["Inbox", "Today", "Anytime", "Upcoming", "Someday", "Logbook", "Trash"]);
const tags = z.array(z.string()).describe("Things tag names. Tags must already exist unless you create them first.");
const optionalDate = z.string().describe("ISO date, like 2026-06-09, or ISO date-time, like 2026-06-09T14:30.");

function asContent(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

export function createThingsPokeMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: "things-poke",
      version: "0.1.0",
    },
    {
      capabilities: {
        logging: {},
      },
      instructions:
        "Use these tools to operate the user's local Things 3 app on macOS. Prefer compact reads before large reads. Use item IDs when updating, moving, completing, canceling, deleting, showing, or editing. Do not call destructive tools like delete_* or empty_trash unless the user explicitly asked for that destructive action. Tags must exist before assigning them; call create_tag when the user asks to introduce a new tag.",
    },
  );

  server.registerTool(
    "get_things_info",
    {
      title: "Get Things Info",
      description: "Check that Things 3 is reachable and return its version.",
      inputSchema: {},
    },
    async () => asContent({ version: await getVersion() }),
  );

  server.registerTool(
    "get_lists",
    {
      title: "Get Lists",
      description: "List Things built-in lists such as Inbox, Today, Upcoming, Anytime, Someday, Logbook, and Trash.",
      inputSchema: {},
    },
    async () => asContent(await getLists()),
  );

  server.registerTool(
    "get_todos",
    {
      title: "Get To-Dos",
      description:
        "Read Things to-dos. Filter by built-in list, project, area, or tag. Use a small limit first unless the user asks for a complete dump.",
      inputSchema: {
        list: listName.optional(),
        project: z.string().optional().describe("Project name to read from."),
        area: z.string().optional().describe("Area name to read from."),
        tag: z.string().optional().describe("Tag name to read from."),
        limit: z.number().int().min(1).max(200).default(30),
      },
    },
    async (args) => asContent(await getTodos(args)),
  );

  server.registerTool(
    "search_todos",
    {
      title: "Search To-Dos",
      description: "Search Things to-dos by title, notes, or tag names.",
      inputSchema: {
        query: z.string(),
        limit: z.number().int().min(1).max(200).default(30),
      },
    },
    async ({ query, limit }) => asContent(await searchTodos(query, limit)),
  );

  server.registerTool(
    "get_projects",
    {
      title: "Get Projects",
      description: "List Things projects, including IDs, status, tags, area, deadline, schedule, and child to-do counts.",
      inputSchema: {},
    },
    async () => asContent(await getProjects()),
  );

  server.registerTool(
    "get_areas",
    {
      title: "Get Areas",
      description: "List Things areas, including IDs, tags, collapsed state, and to-do counts.",
      inputSchema: {},
    },
    async () => asContent(await getAreas()),
  );

  server.registerTool(
    "get_tags",
    {
      title: "Get Tags",
      description: "List Things tags, including IDs, parent tag hierarchy, keyboard shortcut, and to-do counts.",
      inputSchema: {},
    },
    async () => asContent(await getTags()),
  );

  server.registerTool(
    "create_todo",
    {
      title: "Create To-Do",
      description:
        "Create a Things to-do in Inbox, a built-in list, a project, or an area. Use ISO dates for deadline and when.",
      inputSchema: {
        title: z.string(),
        notes: z.string().optional(),
        tags: tags.optional(),
        list: listName.default("Inbox"),
        project: z.string().optional(),
        area: z.string().optional(),
        deadline: optionalDate.optional(),
        when: optionalDate.optional(),
        reveal: z.boolean().default(false),
      },
    },
    async (args) => asContent(await createTodo(args)),
  );

  server.registerTool(
    "create_project",
    {
      title: "Create Project",
      description: "Create a Things project with optional area, tags, dates, notes, and initial to-dos.",
      inputSchema: {
        title: z.string(),
        notes: z.string().optional(),
        tags: tags.optional(),
        area: z.string().optional(),
        deadline: optionalDate.optional(),
        when: optionalDate.optional(),
        todos: z.array(z.string()).optional(),
        reveal: z.boolean().default(false),
      },
    },
    async (args) => asContent(await createProject(args)),
  );

  server.registerTool(
    "create_area",
    {
      title: "Create Area",
      description: "Create a Things area of responsibility.",
      inputSchema: {
        name: z.string(),
        tags: tags.optional(),
      },
    },
    async ({ name, tags }) => asContent(await createArea(name, tags)),
  );

  server.registerTool(
    "create_tag",
    {
      title: "Create Tag",
      description: "Create a Things tag, optionally under an existing parent tag.",
      inputSchema: {
        name: z.string(),
        parent: z.string().optional(),
      },
    },
    async ({ name, parent }) => asContent(await createTag(name, parent)),
  );

  server.registerTool(
    "update_todo",
    {
      title: "Update To-Do",
      description: "Update a Things to-do by ID. Can rename, edit notes, set tags, schedule, deadline, or status.",
      inputSchema: {
        id: z.string(),
        title: z.string().optional(),
        notes: z.string().optional(),
        tags: tags.optional(),
        deadline: optionalDate.optional(),
        when: optionalDate.optional(),
        status: z.enum(["open", "completed", "canceled"]).optional(),
      },
    },
    async (args) => asContent(await updateTodo(args)),
  );

  server.registerTool(
    "update_project",
    {
      title: "Update Project",
      description: "Update a Things project by ID. Can rename, edit notes, set tags, schedule, deadline, status, or area.",
      inputSchema: {
        id: z.string(),
        title: z.string().optional(),
        notes: z.string().optional(),
        tags: tags.optional(),
        deadline: optionalDate.optional(),
        when: optionalDate.optional(),
        status: z.enum(["open", "completed", "canceled"]).optional(),
        area: z.string().optional(),
      },
    },
    async (args) => asContent(await updateProject(args)),
  );

  server.registerTool(
    "move_todo",
    {
      title: "Move To-Do",
      description: "Move a Things to-do by ID to a built-in list, project, or area.",
      inputSchema: {
        id: z.string(),
        list: listName.optional(),
        project: z.string().optional(),
        area: z.string().optional(),
      },
    },
    async (args) => asContent(await moveTodo(args)),
  );

  server.registerTool(
    "delete_todo",
    {
      title: "Delete To-Do",
      description: "Move a Things to-do to Trash by ID. Only use when the user explicitly asks to delete/trash it.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => asContent(await deleteTodo(id)),
  );

  server.registerTool(
    "delete_project",
    {
      title: "Delete Project",
      description: "Move a Things project and its child to-dos to Trash by ID. Only use when explicitly requested.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => asContent(await deleteProject(id)),
  );

  server.registerTool(
    "delete_area",
    {
      title: "Delete Area",
      description: "Delete a Things area by ID. Its children may be affected. Only use when explicitly requested.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => asContent(await deleteArea(id)),
  );

  server.registerTool(
    "delete_tag",
    {
      title: "Delete Tag",
      description: "Delete a Things tag by ID. Only use when explicitly requested.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => asContent(await deleteTag(id)),
  );

  server.registerTool(
    "show_in_things",
    {
      title: "Show In Things",
      description: "Reveal a to-do, project, area, or list in the Things app.",
      inputSchema: {
        type: z.enum(["todo", "project", "area", "list"]),
        id: z.string().optional(),
        name: z.string().optional(),
      },
    },
    async (args) => asContent(await showItem(args)),
  );

  server.registerTool(
    "edit_todo_in_things",
    {
      title: "Edit To-Do In Things",
      description: "Open a to-do in Things edit mode by ID.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => asContent(await editTodo(id)),
  );

  server.registerTool(
    "open_quick_entry",
    {
      title: "Open Quick Entry",
      description: "Open the Things Quick Entry panel, optionally prefilled or with autofill.",
      inputSchema: {
        title: z.string().optional(),
        notes: z.string().optional(),
        tags: tags.optional(),
        deadline: optionalDate.optional(),
        autofill: z.boolean().default(false),
      },
    },
    async (args) => asContent(await quickEntry(args)),
  );

  server.registerTool(
    "search_in_things",
    {
      title: "Search In Things",
      description: "Open the Things app search UI for a query.",
      inputSchema: { query: z.string() },
    },
    async ({ query }) => asContent(await searchInThings(query)),
  );

  server.registerTool(
    "log_completed_now",
    {
      title: "Log Completed Now",
      description: "Tell Things to log completed items now.",
      inputSchema: {},
    },
    async () => asContent(await logCompletedNow()),
  );

  server.registerTool(
    "empty_trash",
    {
      title: "Empty Trash",
      description: "Empty Things Trash. This is destructive; only use when the user explicitly asks.",
      inputSchema: {},
    },
    async () => asContent(await emptyTrash()),
  );

  return server;
}
