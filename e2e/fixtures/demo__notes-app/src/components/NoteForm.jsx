import { useState } from "react";

const MAX_LENGTH = 280;

export function NoteForm({ onAdd }) {
  const [text, setText] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return;
        onAdd(text.trim().slice(0, MAX_LENGTH));
        setText("");
      }}
    >
      <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={MAX_LENGTH} />
      <button type="submit">Save note</button>
    </form>
  );
}
