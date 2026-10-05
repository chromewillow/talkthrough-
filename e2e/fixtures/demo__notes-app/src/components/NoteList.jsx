export function NoteList({ notes, onDelete }) {
  if (notes.length === 0) return <p>No notes yet.</p>;
  return (
    <ul>
      {notes.map((note) => (
        <li key={note.id}>
          <span>{note.text}</span>
          <button onClick={() => onDelete(note.id)}>Delete</button>
        </li>
      ))}
    </ul>
  );
}
