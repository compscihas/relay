#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { Command } from "commander";
import { MultiplayerClient, RelayError, type ConversationView, type MessageView } from "@relay/sdk";
import { clearTokens, loadCliConfig, saveCliConfig, saveTokens } from "./config.js";

const program = new Command().name("relay").description("Make your application multiplayer in minutes.").version("0.1.0");

async function promptSecret(label: string): Promise<string> {
  if (!stdin.isTTY || !stdin.setRawMode) {
    const rl = createInterface({ input: stdin, output: stdout });
    const value = await rl.question(label);
    rl.close();
    return value;
  }
  return new Promise((resolve, reject) => {
    let value = "";
    const wasRaw = stdin.isRaw;
    stdout.write(label);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const cleanup = () => { stdin.off("data", onData); stdin.setRawMode(Boolean(wasRaw)); stdout.write("\n"); };
    const onData = (chunk: string | Buffer) => {
      for (const character of chunk.toString()) {
        if (character === "\r" || character === "\n") { cleanup(); resolve(value); return; }
        if (character === "\u0003") { cleanup(); reject(new Error("Cancelled")); return; }
        if (character === "\b" || character === "\u007f") { if (value) { value = value.slice(0, -1); stdout.write("\b \b"); } }
        else { value += character; stdout.write("*"); }
      }
    };
    stdin.on("data", onData);
  });
}

async function context(requireApp = false) {
  const config = await loadCliConfig();
  const client = new MultiplayerClient({ ...config, onTokens: saveTokens });
  if (requireApp && !config.currentAppId) throw new Error("No current application. Run `relay app use <id>` or create an app first.");
  return { config, client, appId: config.currentAppId! };
}

function showMessage(message: MessageView) {
  console.log(`[${new Date(message.createdAt).toLocaleTimeString()}] @${message.sender.username}: ${message.body}`);
}

program.command("signup")
  .requiredOption("--email <email>").requiredOption("--username <username>").requiredOption("--name <displayName>")
  .option("--password <password>", "Password (omit for a masked prompt; command-line values may appear in shell history)")
  .action(async (options) => {
    const password = options.password ?? await promptSecret("Password: ");
    const { client } = await context();
    const result = await client.signup({ email: options.email, username: options.username, displayName: options.name, password });
    console.log(`Signed up as @${result.user.username}`);
  });

program.command("login").requiredOption("--email <email>").option("--password <password>").action(async (options) => {
  const password = options.password ?? await promptSecret("Password: ");
  const { client } = await context();
  const result = await client.login(options.email, password);
  console.log(`Logged in as @${result.user.username}`);
});

program.command("logout").action(async () => {
  const { client } = await context();
  await client.logout().catch(() => undefined);
  await clearTokens();
  console.log("Logged out.");
});

program.command("whoami").action(async () => { const { client } = await context(); const user = await client.me(); console.log(`@${user.username} (${user.displayName}) <${user.email}>`); });
program.command("user").argument("<username>").action(async (username) => { const { client } = await context(); const user = await client.user(username); console.log(`@${user.username} — ${user.displayName}`); });

program.command("config").description("Configure the API endpoint").argument("<apiUrl>").action(async (apiUrl) => {
  const url = new URL(apiUrl);
  if (!/^https?:$/.test(url.protocol)) throw new Error("API URL must use http or https");
  const config = await loadCliConfig();
  await saveCliConfig({ ...config, baseUrl: url.toString().replace(/\/$/, "") });
  console.log(`API endpoint set to ${url.toString().replace(/\/$/, "")}`);
});

const appCommand = program.command("app");
appCommand.command("create").argument("<name>").option("--slug <slug>").action(async (name, options) => {
  const { client, config } = await context();
  const application = await client.createApp(name, options.slug);
  await saveCliConfig({ ...config, currentAppId: application.id });
  console.log(`Created ${application.name} (${application.id}) and selected it.`);
});
appCommand.command("list").action(async () => { const { client, config } = await context(); for (const app of await client.apps()) console.log(`${app.id === config.currentAppId ? "*" : " "} ${app.name}  ${app.id}  ${app.role}`); });
appCommand.command("current").action(async () => { const { client, config } = await context(true); const app = (await client.apps()).find((item) => item.id === config.currentAppId); console.log(app ? `${app.name} (${app.id})` : "Current application is unavailable"); });
appCommand.command("use").argument("<appId>").action(async (appId) => { const { client, config } = await context(); const app = (await client.apps()).find((item) => item.id === appId); if (!app) throw new Error("Application is not in your membership list"); await saveCliConfig({ ...config, currentAppId: app.id }); console.log(`Selected ${app.name}.`); });
appCommand.command("members").action(async () => { const { client, appId } = await context(true); for (const member of await client.members(appId)) console.log(`@${member.user.username}  ${member.role}`); });
appCommand.command("invite").argument("<username>").action(async (username) => { const { client, appId } = await context(true); await client.invite(appId, username); console.log(`Invited ${username}.`); });
appCommand.command("group").argument("<name>").argument("[usernames...]").action(async (name, usernames) => { const { client, appId } = await context(true); const room = await client.createGroup(appId, name, usernames); console.log(`Created #${room.name} (${room.id}).`); });

const invitationCommand = program.command("invite");
invitationCommand.command("list").action(async () => { const { client } = await context(); for (const invite of await client.invitations()) console.log(`${invite.id}  ${invite.application.name}`); });
invitationCommand.command("accept").argument("<invitationId>").action(async (id) => { const { client, config } = await context(); const result = await client.acceptInvitation(id); await saveCliConfig({ ...config, currentAppId: result.applicationId }); console.log("Invitation accepted and application selected."); });

program.command("send").argument("<username>").argument("<message>").action(async (username, body) => { const { client, appId } = await context(true); const room = await client.direct(appId, username); showMessage(await client.sendMessage(room.id, body)); });
program.command("history").argument("<username>").action(async (username) => { const { client, appId } = await context(true); const room = await client.direct(appId, username); for (const message of await client.messages(room.id)) showMessage(message); });
program.command("inbox").action(async () => { const { client, appId } = await context(true); for (const room of await client.conversations(appId)) { const history = await client.messages(room.id, 100); const latest = history.at(-1); if (latest) console.log(`${room.type === "group" ? `#${room.name}` : room.members.map((m) => `@${m.username}`).join(", ")} — @${latest.sender.username}: ${latest.body}`); } });

program.command("chat").option("--room <nameOrId>", "Group room name or ID", "general").action(async (options) => {
  const { client, appId } = await context(true);
  const rooms = await client.conversations(appId);
  const room = rooms.find((item) => item.id === options.room || item.name === options.room);
  if (!room) throw new Error(`Room '${options.room}' was not found`);
  console.log(`\n#${room.name ?? "direct"}\n`);
  for (const message of await client.messages(room.id)) showMessage(message);
  const socket = client.realtime((event) => { if (event.type === "message.created" && event.data.conversationId === room.id) showMessage(event.data); });
  socket.on("error", (error) => console.error(`Realtime error: ${error.message}`));
  const rl = createInterface({ input: stdin, output: stdout, prompt: "> " });
  rl.prompt();
  for await (const line of rl) {
    const body = line.trim();
    if (body === "/quit") break;
    if (body) await client.sendMessage(room.id, body);
    rl.prompt();
  }
  socket.close();
  rl.close();
});

program.parseAsync().catch((error: unknown) => {
  const message = error instanceof RelayError ? `${error.status}: ${error.message}` : error instanceof Error ? error.message : String(error);
  console.error(`relay: ${message}`);
  process.exitCode = 1;
});
