import { createChildLogger } from "../lib/logger.ts";
import type {
  Notification,
  ApprovalNotification,
  ChannelSender,
} from "./dispatcher.ts";

const log = createChildLogger("discord");

interface DiscordConfig {
  bot_token: string;
  channel_id: string;
}

interface DiscordClient {
  channels: {
    fetch(id: string): Promise<DiscordTextChannel | null>;
  };
  on(event: string, handler: (...args: unknown[]) => void): void;
  login(token: string): Promise<void>;
  destroy(): void;
}

interface DiscordTextChannel {
  send(options: unknown): Promise<unknown>;
}

export function createDiscordSender(
  resolveApproval?: (
    token: string,
    decision: "approved" | "rejected"
  ) => { jobId: string; stepIndex: number } | null
): {
  sender: ChannelSender;
  startBot: (botToken: string) => Promise<void>;
  stopBot: () => void;
} {
  let client: DiscordClient | null = null;
  // Discord custom_id max is 100 chars — JWT tokens exceed that.
  // Map short IDs to full tokens for button interactions.
  const pendingTokens = new Map<string, string>();
  let tokenCounter = 0;

  const sender: ChannelSender = async (channel, notification) => {
    if (!client) {
      log.warn("Discord client not initialized");
      return;
    }

    const config = JSON.parse(channel.config) as DiscordConfig;
    const textChannel = await client.channels.fetch(config.channel_id);
    if (!textChannel) {
      log.error({ channelId: config.channel_id }, "Discord channel not found");
      return;
    }

    const isApproval = "approveToken" in notification;

    if (isApproval) {
      const approval = notification as ApprovalNotification;
      const shortId = String(++tokenCounter);
      pendingTokens.set(shortId, approval.approveToken);
      // Build extra fields from metadata for richer context
      const extraFields: { name: string; value: string; inline?: boolean }[] = [
        { name: "Job", value: approval.jobId, inline: true },
        { name: "Step", value: String(approval.stepIndex + 1), inline: true },
      ];
      const meta = (approval as any).metadata as Record<string, unknown> | undefined;
      if (meta) {
        if (meta.tool) extraFields.push({ name: "Tool", value: String(meta.tool), inline: true });
        // Show a preview of the input (truncated)
        if (meta.input && typeof meta.input === "object") {
          const preview = JSON.stringify(meta.input, null, 2);
          if (preview.length > 2) {
            extraFields.push({
              name: "Input Preview",
              value: "```json\n" + preview.slice(0, 900) + (preview.length > 900 ? "\n..." : "") + "\n```",
            });
          }
        }
      }

      await textChannel.send({
        embeds: [
          {
            title: approval.title,
            description: approval.message,
            color: 0xffa500,
            fields: extraFields,
          },
        ],
        components: [
          {
            type: 1, // ActionRow
            components: [
              {
                type: 2, // Button
                style: 3, // Success (green)
                label: "Approve",
                custom_id: `approve:${shortId}`,
              },
              {
                type: 2, // Button
                style: 4, // Danger (red)
                label: "Reject",
                custom_id: `reject:${shortId}`,
              },
            ],
          },
        ],
      });
    } else {
      const colorMap = {
        info: 0x3498db,
        warning: 0xf39c12,
        error: 0xe74c3c,
        success: 0x2ecc71,
      };

      await textChannel.send({
        embeds: [
          {
            title: notification.title,
            description: notification.message,
            color: colorMap[notification.level],
          },
        ],
      });
    }
  };

  const startBot = async (botToken: string) => {
    // Dynamic import — discord.js is an optional dependency
    const { Client, GatewayIntentBits } = await import("discord.js" as string);

    client = new Client({
      intents: [GatewayIntentBits.Guilds],
    }) as unknown as DiscordClient;

    client.on("interactionCreate", async (interaction: unknown) => {
      const i = interaction as {
        isButton(): boolean;
        customId: string;
        reply(options: { content: string; ephemeral: boolean }): Promise<void>;
      };

      if (!i.isButton()) return;

      const [action, shortId] = i.customId.split(":");
      if (!shortId || !resolveApproval) return;

      const token = pendingTokens.get(shortId);
      if (!token) {
        await i.reply({
          content: "This approval has expired or is invalid.",
          ephemeral: true,
        });
        return;
      }

      const decision =
        action === "approve" ? "approved" : ("rejected" as const);
      const result = resolveApproval(token, decision);

      if (result) {
        pendingTokens.delete(shortId);
        await i.reply({
          content: `${decision === "approved" ? "Approved" : "Rejected"} job ${result.jobId} step ${result.stepIndex}`,
          ephemeral: true,
        });
        log.info(
          { jobId: result.jobId, step: result.stepIndex, decision },
          "Approval resolved via Discord"
        );
      } else {
        await i.reply({
          content: "This approval has expired or is invalid.",
          ephemeral: true,
        });
      }
    });

    await client.login(botToken);
    log.info("Discord bot connected");
  };

  const stopBot = () => {
    if (client) {
      client.destroy();
      client = null;
      log.info("Discord bot disconnected");
    }
  };

  return { sender, startBot, stopBot };
}
