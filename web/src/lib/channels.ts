export type ChannelDef = {
  id: string;
  label: string;
  description: string;
  template: Record<string, unknown>;
};

export const CHANNEL_DEFS: ChannelDef[] = [
  { id: 'telegram', label: 'Telegram', description: 'Telegram bot', template: { bot_token: '', allowed_users: [], stream_mode: 'partial', draft_update_interval_ms: 1000, interrupt_on_new_message: true, mention_only: false } },
  { id: 'discord', label: 'Discord', description: 'Discord bot', template: { bot_token: '', guild_id: '', allowed_users: [], listen_to_bots: false, mention_only: true } },
  { id: 'slack', label: 'Slack', description: 'Slack app bot', template: { bot_token: '', app_token: '', channel_id: '', allowed_users: [] } },
  { id: 'mattermost', label: 'Mattermost', description: 'Mattermost bot', template: { url: 'https://mattermost.example.com', bot_token: '', channel_id: '', allowed_users: [], thread_replies: true, mention_only: false } },
  { id: 'webhook', label: 'Webhook', description: 'HTTP inbound webhook', template: { port: 8787, secret: '' } },
  { id: 'imessage', label: 'iMessage', description: 'macOS iMessage bridge', template: { allowed_contacts: [] } },
  { id: 'matrix', label: 'Matrix', description: 'Matrix bot', template: { homeserver: 'https://matrix.org', access_token: '', user_id: '', device_id: '', room_id: '', allowed_users: [] } },
  { id: 'signal', label: 'Signal', description: 'signal-cli HTTP daemon', template: { http_url: 'http://127.0.0.1:8686', account: '+1234567890', group_id: '', allowed_from: ['*'], ignore_attachments: false, ignore_stories: false } },
  { id: 'whatsapp', label: 'WhatsApp', description: 'Cloud API or Web mode', template: { access_token: '', phone_number_id: '', verify_token: '', app_secret: '', session_path: '', pair_phone: '', pair_code: '', allowed_numbers: ['*'] } },
  { id: 'linq', label: 'Linq', description: 'Linq Partner API', template: { api_token: '', from_phone: '+1234567890', signing_secret: '', allowed_senders: ['*'] } },
  { id: 'wati', label: 'WATI', description: 'WATI Business API', template: { api_token: '', api_url: 'https://live-mt-server.wati.io', tenant_id: '', allowed_numbers: ['*'] } },
  { id: 'nextcloud_talk', label: 'Nextcloud Talk', description: 'Nextcloud Talk bot', template: { base_url: 'https://cloud.example.com', app_token: '', webhook_secret: '', allowed_users: ['*'] } },
  { id: 'email', label: 'Email', description: 'IMAP/SMTP channel', template: { imap_host: 'imap.example.com', imap_port: 993, imap_folder: 'INBOX', smtp_host: 'smtp.example.com', smtp_port: 465, smtp_tls: true, username: '', password: '', from_address: 'bot@example.com', idle_timeout_secs: 1740, allowed_senders: ['*'] } },
  { id: 'irc', label: 'IRC', description: 'IRC bot', template: { server: 'irc.libera.chat', port: 6697, nickname: 'zeroclaw-bot', username: 'zeroclaw', channels: ['#general'], allowed_users: ['*'], server_password: '', nickserv_password: '', sasl_password: '', verify_tls: true } },
  { id: 'lark', label: 'Lark', description: 'Lark international bot', template: { app_id: '', app_secret: '', encrypt_key: '', verification_token: '', allowed_users: ['*'], mention_only: true, use_feishu: false, receive_mode: 'websocket', port: null } },
  { id: 'feishu', label: 'Feishu', description: 'Feishu CN bot', template: { app_id: '', app_secret: '', encrypt_key: '', verification_token: '', allowed_users: ['*'], receive_mode: 'websocket', port: null } },
  { id: 'dingtalk', label: 'DingTalk', description: 'DingTalk stream mode', template: { client_id: '', client_secret: '', allowed_users: ['*'] } },
  { id: 'qq', label: 'QQ Official Bot', description: 'Tencent QQ bot', template: { app_id: '', app_secret: '', allowed_users: ['*'] } },
  { id: 'nostr', label: 'Nostr', description: 'Nostr private messages', template: { private_key: '', relays: ['wss://relay.damus.io'], allowed_pubkeys: ['*'] } },
  { id: 'clawdtalk', label: 'ClawdTalk', description: 'Telnyx SIP voice channel', template: { api_key: '', connection_id: '', from_number: '+1234567890', allowed_destinations: ['*'], webhook_secret: '' } },
];

export const CHANNEL_LABEL_MAP = Object.fromEntries(
  CHANNEL_DEFS.map((channel) => [channel.id, channel.label]),
) as Record<string, string>;
