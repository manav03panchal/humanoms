import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { applySchema } from "../../src/db/schema.ts";
import {
  NotificationDispatcher,
  type Notification,
} from "../../src/notifications/dispatcher.ts";
import { generateId } from "../../src/lib/ulid.ts";

describe("NotificationDispatcher", () => {
  let db: Database;
  let dispatcher: NotificationDispatcher;

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
    dispatcher = new NotificationDispatcher(db);
  });

  afterEach(() => {
    db.close();
  });

  function insertChannel(type: string, enabled = 1): string {
    const id = generateId();
    db.query(
      `INSERT INTO notification_channels (id, type, name, config, enabled)
       VALUES (?, ?, ?, ?, ?)`
    ).run(id, type, `${type}-channel`, "{}", enabled);
    return id;
  }

  test("send calls registered sender for matching channel", async () => {
    insertChannel("discord");
    const sent: Notification[] = [];

    dispatcher.registerSender("discord", async (_channel, notification) => {
      sent.push(notification);
    });

    await dispatcher.send({
      title: "Test",
      message: "Hello",
      level: "info",
    });

    expect(sent.length).toBe(1);
    expect(sent[0]!.title).toBe("Test");
  });

  test("send skips disabled channels", async () => {
    insertChannel("discord", 0);
    const sent: Notification[] = [];

    dispatcher.registerSender("discord", async (_channel, notification) => {
      sent.push(notification);
    });

    await dispatcher.send({
      title: "Test",
      message: "Hello",
      level: "info",
    });

    expect(sent.length).toBe(0);
  });

  test("send skips channels without registered sender", async () => {
    insertChannel("slack"); // no sender registered for "slack"

    // Should not throw
    await dispatcher.send({
      title: "Test",
      message: "Hello",
      level: "info",
    });
  });

  test("send handles sender errors gracefully", async () => {
    insertChannel("discord");

    dispatcher.registerSender("discord", async () => {
      throw new Error("Connection failed");
    });

    // Should not throw
    await dispatcher.send({
      title: "Test",
      message: "Hello",
      level: "error",
    });
  });

  test("sends to multiple enabled channels", async () => {
    insertChannel("discord");
    insertChannel("discord");
    let count = 0;

    dispatcher.registerSender("discord", async () => {
      count++;
    });

    await dispatcher.send({
      title: "Test",
      message: "Multi",
      level: "info",
    });

    expect(count).toBe(2);
  });
});
