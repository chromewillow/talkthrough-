import { useState } from "react";
import { NoteForm } from "./components/NoteForm";
import { NoteList } from "./components/NoteList";
import { loadNotes, saveNotes } from "./lib/storage";

export function App() {
  const [notes, setNotes] = useState(loadNotes);

  function add(text) {
    const next = [{ id: crypto.randomUUID(), text, createdAt: Date.now() }, ...notes];
    setNotes(next);
    saveNotes(next);
  }

  function remove(id) {
    const next = notes.filter((n) => n.id !== id);
    setNotes(next);
    saveNotes(next);
  }

  return (
    <main>
      <h1>Notes</h1>
      <NoteForm onAdd={add} />
      <NoteList notes={notes} onDelete={remove} />
    </main>
  );
}
