import React, { useEffect, useRef, useState } from 'react';
import { usePanelStore } from '../state/store';
import { send } from '../state/bridge';
import { useGenerativeUiBindings } from '../copilot/actions';
import { EmptyState, Skeleton } from '../cards/primitives';

const SUGGESTED = [
  'My priorities today?',
  'What can I unsubscribe from?',
  'Emails I need to reply to',
  'Payment reminders',
  'What did you do today?',
];

/**
 * ChatTab — custom chat UI that hosts CopilotKit generative-UI bindings.
 *
 * Why not use <CopilotChat> from @copilotkit/react-ui directly? Our service
 * worker already routes chat through the multi-agent orchestrator over the
 * extension messaging channel; the CopilotKit runtime URL is wired so cards
 * registered with useCopilotAction can still render in-chat when the agent
 * emits the corresponding tool calls. This keeps a single source of truth
 * for traces, ledger, and policy gates.
 */
export function ChatTab(): JSX.Element {
  // Mounts the generative-UI action set so the agent can render any card.
  useGenerativeUiBindings();

  const chat = usePanelStore((s) => s.chat);
  const pushUser = usePanelStore((s) => s.pushChatUser);
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // auto-scroll on new messages
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
    // when assistant replies, drop the pending state
    const last = chat[chat.length - 1];
    if (last?.role === 'assistant') setPending(false);
  }, [chat]);

  const sendMsg = (t: string) => {
    if (!t.trim()) return;
    pushUser(t);
    setPending(true);
    send({ kind: 'panel/chat_message', text: t });
    setText('');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="chat-log" ref={logRef}>
        {chat.length === 0 && (
          <EmptyState
            title="Ask about your inbox"
            body="I'll never act on it without showing you the action card first."
            hint="Try one of the chips below, or ask anything."
          />
        )}
        {chat.map((m) => (
          <div key={m.id} className={`bubble ${m.role}`}>
            {m.text}
          </div>
        ))}
        {pending && (
          <div className="bubble assistant" aria-busy="true">
            <Skeleton lines={2} />
          </div>
        )}
      </div>
      <div className="chat-suggestions">
        {SUGGESTED.map((s) => (
          <button key={s} onClick={() => sendMsg(s)} disabled={pending}>
            {s}
          </button>
        ))}
      </div>
      <div className="chat-input-row">
        <textarea
          className="input"
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ask anything about your inbox…"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              sendMsg(text);
            }
          }}
        />
        <button className="primary" onClick={() => sendMsg(text)} disabled={pending}>
          Send
        </button>
      </div>
    </div>
  );
}
