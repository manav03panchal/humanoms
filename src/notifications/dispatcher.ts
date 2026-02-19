import type { Database } from "bun:sqlite";
import { createChildLogger } from "../lib/logger.ts";

const log = createChildLogger("notifications");

export interface Notification {
  title: string;
  message: string;
  level: "info" | "warning" | "error" | "success";
  metadata?: Record<string, unknown>;
}

export interface ApprovalNotification extends Notification {
  jobId: string;
  stepIndex: number;
  approveToken: string;
  rejectToken: string;
}

interface ChannelRow {
  id: string;
  type: string;
  name: string;
  config: string;
  enabled: number;
}

export type ChannelSender = (
  channel: ChannelRow,
  notification: Notification
) => Promise<void>;

export class NotificationDispatcher {
  private db: Database;
  private senders: Map<string, ChannelSender> = new Map();

  constructor(db: Database) {
    this.db = db;
  }

  registerSender(type: string, sender: ChannelSender): void {
    this.senders.set(type, sender);
    log.debug({ type }, "Registered notification sender");
  }

  async send(notification: Notification): Promise<void> {
    const channels = this.db
      .query<ChannelRow, []>(
        "SELECT * FROM notification_channels WHERE enabled = 1"
      )
      .all();

    for (const channel of channels) {
      const sender = this.senders.get(channel.type);
      if (!sender) {
        log.warn({ type: channel.type }, "No sender registered for channel type");
        continue;
      }

      try {
        await sender(channel, notification);
        log.info(
          { channel: channel.name, type: channel.type },
          "Notification sent"
        );
      } catch (err) {
        log.error(
          { channel: channel.name, err: (err as Error).message },
          "Failed to send notification"
        );
      }
    }
  }

  async sendApproval(notification: ApprovalNotification): Promise<void> {
    const channels = this.db
      .query<ChannelRow, []>(
        "SELECT * FROM notification_channels WHERE enabled = 1"
      )
      .all();

    for (const channel of channels) {
      const sender = this.senders.get(channel.type);
      if (!sender) continue;

      try {
        await sender(channel, notification);
      } catch (err) {
        log.error(
          { channel: channel.name, err: (err as Error).message },
          "Failed to send approval notification"
        );
      }
    }
  }
}
