"use client";

export function FarmDeleteButton({ action, farmName }: { action: (formData: FormData) => void | Promise<void>; farmName: string }) {
  return <form action={action} onSubmit={(event) => { if (!window.confirm(`Excluir a fazenda “${farmName}” e todos os dados vinculados?`)) event.preventDefault(); }}>
    <button className="icon-button danger" type="submit" aria-label={`Excluir ${farmName}`} title="Excluir fazenda">×</button>
  </form>;
}
