export function MothMark() {
  return (
    <svg className="moth" viewBox="0 0 48 48" aria-hidden="true">
      <path d="M24 7 14 20l10 22 10-22z" />
      <path d="M21 18 5 10l7 22 9-4M27 18l16-8-7 22-9-4" />
      <path d="M24 7v35" />
    </svg>
  );
}

export function ImageStrip({ attachments, onOpen }: { attachments: { id: string; url: string; mimeType: string }[]; onOpen: (index: number) => void }) {
  if (attachments.length === 0) return <p className="muted-pad">No images attached.</p>;
  return <div className="thumb-strip">{attachments.map((attachment, index) => <button key={attachment.id} onClick={() => onOpen(index)} aria-label="Open image"><img src={attachment.url} alt="" /></button>)}</div>;
}

export function ImageViewer({ attachments, index, onChange, onClose }: { attachments: { id: string; url: string }[]; index: number; onChange: (index: number) => void; onClose: () => void }) {
  const active = attachments[index];
  if (!active) return null;
  return (
    <div className="image-viewer" onClick={onClose}>
      <img className="image-full" src={active.url} alt="" />
      <div className="viewer-thumbs" onClick={(event) => event.stopPropagation()}>
        {attachments.map((attachment, nextIndex) => <button className={nextIndex === index ? "picked" : ""} key={attachment.id} onClick={() => onChange(nextIndex)}><img src={attachment.url} alt="" /></button>)}
      </div>
    </div>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return <section className="empty"><MothMark /><h1>{title}</h1><p>{body}</p></section>;
}
