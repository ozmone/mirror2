import { useState } from "react";
import type { CharacterActionMacro } from "../../types";

export function DeltaActionTree({
  macros,
  parentId,
  editMode,
  onChoose,
  onAdd,
  onEdit,
  onDelete
}: {
  macros: CharacterActionMacro[];
  parentId?: string;
  editMode: boolean;
  onChoose: (macro: CharacterActionMacro) => void;
  onAdd: (parentId: string | undefined, folder: boolean) => void;
  onEdit: (macro: CharacterActionMacro) => void;
  onDelete: (macro: CharacterActionMacro) => void;
}) {
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const children = macros.filter((macro) => macro.parentId === parentId).sort((a, b) => a.orderIndex - b.orderIndex);
  if (children.length === 0) return null;
  return (
    <div className="delta-action-tree">
      {children.map((macro) => {
        const isMenu = macro.template === undefined;
        const open = openIds.has(macro.id);
        return (
          <div className="delta-action-node" key={macro.id}>
            <div className="delta-action-row">
              <button
                type="button"
                onClick={() => {
                  if (!isMenu) {
                    onChoose(macro);
                    return;
                  }
                  setOpenIds((current) => {
                    const next = new Set(current);
                    if (next.has(macro.id)) next.delete(macro.id);
                    else next.add(macro.id);
                    return next;
                  });
                }}
              >
                {isMenu ? (open ? "v " : "> ") : ""}{macro.label}
              </button>
              {editMode && isMenu && <button type="button" onClick={() => onAdd(macro.id, true)}>+ Menu</button>}
              {editMode && isMenu && <button type="button" onClick={() => onAdd(macro.id, false)}>+ Action</button>}
              {editMode && <button type="button" onClick={() => onEdit(macro)}>Edit</button>}
              {editMode && <button type="button" onClick={() => onDelete(macro)}>-</button>}
            </div>
            {isMenu && open && (
              <DeltaActionTree
                macros={macros}
                parentId={macro.id}
                editMode={editMode}
                onChoose={onChoose}
                onAdd={onAdd}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
