import React, { useState } from 'react';
import { usePanelStore } from '../state/store';
import { send } from '../state/bridge';

const SUGGESTED = [
  'What are my priorities today?',
  'What can I unsubscribe from?',
  'Show me emails I need to reply to.',
  'Summarize payment reminders.',
  'What did you do on my behalf today?',
];

export function ChatTab(): JSX.Element {
  const chat = usePanelStore((s) => s.chat);
  const pushUser = usePanelStore((s) => s.pushChatUser);
  const [text, setText] = useState('');

  const sendMsg = (t: string) => {
    if (!t.trim()) return;
    pushUser(t);
    send({ kind: 'panel/chat_message', text: t });
    setText('');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="chat-log">
        {chat.length === 0 && (
          <div className="empty">
            Ask me about your inbox. I'll never act on it without showing you the action card
            first.
          </div>
        )}
        {chat.map((m) => (
          <div key={m.id} className={`bubble ${m.role}`}>
            {m.text}
          </div>
        ))}
      </div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        {SUGGESTED.map((s) => (
          <button key={s} className="ghost" onClick={() => sendMsg(s)}>
            {s}
          </button>
        ))}
      </div>
      <div className="row">
        <textarea
          className="input"
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ask EmailSignal anything about your inbox…"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              sendMsg(text);
            }
          }}
        />
        <button className="primary" onClick={() => sendMsg(text)}>
          Send
        </button>
      </div>
    </div>
  );
}
