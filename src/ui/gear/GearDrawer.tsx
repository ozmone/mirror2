import { type RefObject, useEffect, useRef, useState } from "react";
import { Trash2, X } from "lucide-react";
import { db } from "../../data/db";
import { characterTemplateStats } from "../../data/repositories";
import { Character, CharacterGearSlot, Chat, GearBodyType, GearSlotName, Project } from "../../types";
import { now, uid } from "../../utils";

const gearBodyImages: Record<GearBodyType, string> = {
  "type-a": "gear/type-a.png",
  "type-b": "gear/type-b.png"
};

const gearSlots: { slot: GearSlotName; label: string; group: "left" | "right" | "carry" }[] = [
  { slot: "head", label: "Head", group: "left" },
  { slot: "torso", label: "Torso", group: "left" },
  { slot: "hands", label: "Hands", group: "left" },
  { slot: "legs", label: "Legs", group: "left" },
  { slot: "feet", label: "Feet", group: "left" },
  { slot: "ear", label: "Ear", group: "right" },
  { slot: "neck", label: "Neck", group: "right" },
  { slot: "wrist", label: "Wrist", group: "right" },
  { slot: "ex1", label: "EX1", group: "right" },
  { slot: "ex2", label: "EX2", group: "right" },
  { slot: "belt", label: "Belt", group: "carry" },
  { slot: "back", label: "Back", group: "carry" }
];

function useSavedNotice() {
  const [saved, setSaved] = useState(false);
  function showSaved() {
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1400);
  }
  return [saved, showSaved] as const;
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return <div className="empty"><h1>{title}</h1><p>{body}</p></div>;
}

export function GearDrawer({ open, project, chat, elevated, onOpenCharacter, onClose, onRefresh }: { open: boolean; project: Project; chat: Chat; elevated?: boolean; onOpenCharacter: (id: string) => void; onClose: () => void; onRefresh: () => Promise<void> }) {
  if (!open) return null;
  return (
    <>
      <button className={`drawer-backdrop ${elevated ? "elevated" : ""}`} onClick={onClose} aria-label="Close gear" />
      <aside className={`inventory-drawer gear-drawer ${elevated ? "delta-inventory" : ""}`}>
        <CharacterGearPanel project={project} chat={chat} onOpenCharacter={onOpenCharacter} onRefresh={onRefresh} />
      </aside>
    </>
  );
}

function CharacterGearPanel({ project, chat, onOpenCharacter, onRefresh }: { project: Project; chat: Chat; onOpenCharacter: (id: string) => void; onRefresh: () => Promise<void> }) {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [selectedCharacterId, setSelectedCharacterId] = useState(chat.deltaPlayerCharacterId ?? "");
  const [selectedCharacter, setSelectedCharacter] = useState<Character>();
  const [slots, setSlots] = useState<CharacterGearSlot[]>([]);
  const [carryMaxKg, setCarryMaxKg] = useState(0);
  const [combatLoadKg, setCombatLoadKg] = useState(0);
  const [infoOpen, setInfoOpen] = useState(false);
  const [saved, showSaved] = useSavedNotice();
  const bodyType = selectedCharacter?.gearBodyType ?? "type-a";
  const slotMap = new Map(slots.map((slot) => [slot.slot, slot]));
  const totalDp = slots.reduce((sum, slot) => sum + (slot.dpBonus ?? 0), 0);
  const totalAp = slots.reduce((sum, slot) => sum + (slot.apBonus ?? 0), 0);
  const totalHp = slots.reduce((sum, slot) => sum + (slot.hpBonus ?? 0), 0);
  const equippedWeightKg = slots.reduce((sum, slot) => sum + (slot.carryWeightKg ?? 0), 0);
  async function load(preferredId = selectedCharacterId) {
    const rows = (await db.characters.where("projectId").equals(project.id).toArray())
      .sort((a, b) => (a.orderIndex ?? Number.MAX_SAFE_INTEGER) - (b.orderIndex ?? Number.MAX_SAFE_INTEGER) || a.normalisedName.localeCompare(b.normalisedName));
    const nextId = rows.some((character) => character.id === preferredId) ? preferredId : rows[0]?.id ?? "";
    const character = rows.find((row) => row.id === nextId);
    setCharacters(rows);
    setSelectedCharacterId(nextId);
    setSelectedCharacter(character);
    setSlots(nextId ? (await db.characterGearSlots.where("characterId").equals(nextId).toArray()).sort((a, b) => a.slot.localeCompare(b.slot)) : []);
    if (character) {
      const stats = await characterTemplateStats(project, character);
      setCarryMaxKg(Math.round(stats.STR * 6.8));
      setCombatLoadKg(Math.round(stats.STR * 3));
    } else {
      setCarryMaxKg(0);
      setCombatLoadKg(0);
    }
  }
  useEffect(() => { void load(chat.deltaPlayerCharacterId ?? ""); }, [project.id, chat.id, chat.deltaPlayerCharacterId]);
  async function saveSlot(slotName: GearSlotName, patch: Partial<CharacterGearSlot>) {
    if (!selectedCharacterId) return;
    const timestamp = now();
    const existing = slotMap.get(slotName);
    const nextItemName = patch.itemName ?? existing?.itemName ?? "";
    if (existing) {
      await db.characterGearSlots.update(existing.id, { ...patch, itemName: nextItemName, updatedAt: timestamp });
    } else {
      await db.characterGearSlots.add({
        id: uid(),
        characterId: selectedCharacterId,
        slot: slotName,
        itemName: nextItemName,
        ...patch,
        createdAt: timestamp,
        updatedAt: timestamp
      });
    }
    showSaved();
    await load(selectedCharacterId);
  }
  async function clearSlot(slotName: GearSlotName) {
    const existing = slotMap.get(slotName);
    if (!existing) return;
    await db.characterGearSlots.delete(existing.id);
    await load(selectedCharacterId);
  }
  if (!characters.length) return <EmptyState title="No characters yet" body="Create a character before assigning gear." />;
  return (
    <section className="character-gear-panel">
      <div className="gear-stage" style={{ backgroundImage: `url(${gearBodyImages[bodyType]})` }}>
        <select className="gear-character-select" value={selectedCharacterId} onChange={(event) => void load(event.target.value)} aria-label="Character">
          {characters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}
        </select>
        <div className="gear-stat-chip dp">DP: {8 + totalDp}</div>
        <div className="gear-stat-chip ap">AP: {5 + totalAp}</div>
        <div className="gear-stat-chip hp">HP: {8 + totalHp}</div>
        <div className="gear-column left">
          {gearSlots.filter((slot) => slot.group === "left").map((slot) => <GearSlotControl key={slot.slot} slot={slot} value={slotMap.get(slot.slot)} onSave={saveSlot} onClear={clearSlot} />)}
        </div>
        <div className="gear-column right">
          {gearSlots.filter((slot) => slot.group === "right").map((slot) => <GearSlotControl key={slot.slot} slot={slot} value={slotMap.get(slot.slot)} onSave={saveSlot} onClear={clearSlot} />)}
        </div>
        <div className="gear-carry-zone">
          {gearSlots.filter((slot) => slot.group === "carry").map((slot) => <GearCarrySlotControl key={slot.slot} slot={slot} value={slotMap.get(slot.slot)} onSave={saveSlot} onClear={clearSlot} />)}
        </div>
        <div className="gear-bottom-actions">
          <button type="button" disabled={!selectedCharacterId} onClick={() => selectedCharacterId && onOpenCharacter(selectedCharacterId)}>Character Editor</button>
          <div className="gear-load-summary">
            <span>Carry Weight: {formatKg(equippedWeightKg)} / {formatKg(carryMaxKg)}</span>
            <span>Combat Load: {formatCombatLoad(equippedWeightKg, combatLoadKg)}</span>
          </div>
          <button type="button" onClick={() => setInfoOpen(true)}>Gear Info</button>
        </div>
      </div>
      {saved && <span className="save-status">Saved</span>}
      {infoOpen && (
        <div className="modal-backdrop" onClick={() => setInfoOpen(false)}>
          <section className="gear-info-modal" onClick={(event) => event.stopPropagation()}>
            <div className="section-title"><h2>Gear Info</h2><button className="icon-button" onClick={() => setInfoOpen(false)} aria-label="Close gear info"><X size={18} /></button></div>
            <div className="info-grid">
              <span>DP</span><strong>{8 + totalDp}</strong>
              <span>AP</span><strong>{5 + totalAp}</strong>
              <span>HP</span><strong>{8 + totalHp}</strong>
              <span>Carry Weight</span><strong>{formatKg(equippedWeightKg)} / {formatKg(carryMaxKg)}</strong>
              <span>Combat Load</span><strong>{formatCombatLoad(equippedWeightKg, combatLoadKg)}</strong>
            </div>
            <div className="stack">
              {slots.filter((slot) => slot.itemName.trim()).map((slot) => (
                <section className="gear-info-item" key={slot.id}>
                  <strong>{gearSlots.find((item) => item.slot === slot.slot)?.label ?? slot.slot}: {slot.itemName}</strong>
                  <small>{[
                    slot.dpBonus ? `DP ${slot.dpBonus > 0 ? "+" : ""}${slot.dpBonus}` : "",
                    slot.apBonus ? `AP ${slot.apBonus > 0 ? "+" : ""}${slot.apBonus}` : "",
                    slot.hpBonus ? `HP ${slot.hpBonus > 0 ? "+" : ""}${slot.hpBonus}` : "",
                    slot.carryWeightKg ? `${formatKg(slot.carryWeightKg)}` : "",
                    slot.combatLoadKg ? `Combat ${formatKg(slot.combatLoadKg)}` : "",
                    slot.carrySlots ? `inv slots ${slot.carrySlots}` : "",
                    slot.carryReductionPercent ? `Weight ${slot.carryReductionPercent}%` : ""
                  ].filter(Boolean).join(" · ") || "No structured effects."}</small>
                  {slot.traits && <p>{slot.traits}</p>}
                </section>
              ))}
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

function GearSlotControl({ slot, value, onSave, onClear }: { slot: { slot: GearSlotName; label: string }; value?: CharacterGearSlot; onSave: (slot: GearSlotName, patch: Partial<CharacterGearSlot>) => Promise<void>; onClear: (slot: GearSlotName) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="gear-slot-row">
      <span>{slot.label}</span>
      <button type="button" className={value?.itemName ? "filled" : ""} onClick={() => setOpen(!open)}>{value?.itemName ? value.itemName.slice(0, 2).toUpperCase() : ""}</button>
      <small>{gearEffectLabel(value)}</small>
      {open && <GearSlotEditor slot={slot.slot} value={value} onSave={onSave} onClear={onClear} onClose={() => setOpen(false)} />}
    </div>
  );
}

function GearCarrySlotControl({ slot, value, onSave, onClear }: { slot: { slot: GearSlotName; label: string }; value?: CharacterGearSlot; onSave: (slot: GearSlotName, patch: Partial<CharacterGearSlot>) => Promise<void>; onClear: (slot: GearSlotName) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const carrySlots = Math.max(0, value?.carrySlots ?? 0);
  return (
    <div className="gear-carry-row">
      <span>{slot.label}</span>
      <button type="button" className={value?.itemName ? "filled" : ""} onClick={() => setOpen(!open)}>{value?.itemName ? value.itemName.slice(0, 2).toUpperCase() : ""}</button>
      <div className="gear-carry-slots">
        {Array.from({ length: Math.min(carrySlots, 8) }).map((_, index) => <span key={index} />)}
      </div>
      <small>{carrySlots ? `+${carrySlots} slots` : ""}</small>
      {open && <GearSlotEditor slot={slot.slot} value={value} onSave={onSave} onClear={onClear} onClose={() => setOpen(false)} carry />}
    </div>
  );
}

function GearSlotEditor({ slot, value, carry, onSave, onClear, onClose }: { slot: GearSlotName; value?: CharacterGearSlot; carry?: boolean; onSave: (slot: GearSlotName, patch: Partial<CharacterGearSlot>) => Promise<void>; onClear: (slot: GearSlotName) => Promise<void>; onClose: () => void }) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [savePromptOpen, setSavePromptOpen] = useState(false);
  const [clearPromptOpen, setClearPromptOpen] = useState(false);
  const [draft, setDraft] = useState({
    itemName: value?.itemName ?? "",
    dpBonus: value?.dpBonus ?? 0,
    apBonus: value?.apBonus ?? 0,
    hpBonus: value?.hpBonus ?? 0,
    carryWeightKg: value?.carryWeightKg ?? 0,
    combatLoadKg: value?.combatLoadKg ?? 0,
    carrySlots: value?.carrySlots ?? 0,
    carryReductionPercent: value?.carryReductionPercent ?? 0,
    traits: value?.traits ?? ""
  });
  async function save() {
    await onSave(slot, {
      itemName: draft.itemName.trim(),
      dpBonus: draft.dpBonus || undefined,
      apBonus: draft.apBonus || undefined,
      hpBonus: draft.hpBonus || undefined,
      carryWeightKg: draft.carryWeightKg || undefined,
      combatLoadKg: draft.combatLoadKg || undefined,
      carrySlots: carry ? Math.max(0, draft.carrySlots) : undefined,
      carryReductionPercent: carry ? Math.max(0, draft.carryReductionPercent) : undefined,
      traits: draft.traits.trim() || undefined
    });
    onClose();
  }
  function changed() {
    return draft.itemName !== (value?.itemName ?? "") ||
      draft.dpBonus !== (value?.dpBonus ?? 0) ||
      draft.apBonus !== (value?.apBonus ?? 0) ||
      draft.hpBonus !== (value?.hpBonus ?? 0) ||
      draft.carryWeightKg !== (value?.carryWeightKg ?? 0) ||
      draft.combatLoadKg !== (value?.combatLoadKg ?? 0) ||
      draft.carrySlots !== (value?.carrySlots ?? 0) ||
      draft.carryReductionPercent !== (value?.carryReductionPercent ?? 0) ||
      draft.traits !== (value?.traits ?? "");
  }
  function hasDraftContent() {
    return Boolean(draft.itemName.trim() || draft.dpBonus || draft.apBonus || draft.hpBonus || draft.carryWeightKg || draft.combatLoadKg || draft.carrySlots || draft.carryReductionPercent || draft.traits.trim());
  }
  async function clearItem() {
    if (value) await onClear(slot);
    setDraft({ itemName: "", dpBonus: 0, apBonus: 0, hpBonus: 0, carryWeightKg: 0, combatLoadKg: 0, carrySlots: 0, carryReductionPercent: 0, traits: "" });
    setClearPromptOpen(false);
    onClose();
  }
  function closeFromOutside() {
    if (clearPromptOpen || savePromptOpen) return;
    if (changed()) setSavePromptOpen(true);
    else onClose();
  }
  useClosePromptOnOutsideClick(popoverRef, closeFromOutside);
  return (
    <div className="gear-slot-popover" ref={popoverRef}>
      <label>Equipped item<input value={draft.itemName} onChange={(event) => setDraft({ ...draft, itemName: event.target.value })} placeholder="gear name" /></label>
      <div className="ability-grid compact">
        <label>DP<input type="number" value={draft.dpBonus} onChange={(event) => setDraft({ ...draft, dpBonus: Number(event.target.value) })} /></label>
        <label>AP<input type="number" value={draft.apBonus} onChange={(event) => setDraft({ ...draft, apBonus: Number(event.target.value) })} /></label>
        <label>HP<input type="number" value={draft.hpBonus} onChange={(event) => setDraft({ ...draft, hpBonus: Number(event.target.value) })} /></label>
      </div>
      <div className="ability-grid compact">
        <label>Weight kg<input type="number" min={0} step={0.1} value={draft.carryWeightKg} onChange={(event) => setDraft({ ...draft, carryWeightKg: Number(event.target.value) })} /></label>
        <label>Combat kg<input type="number" min={0} step={0.1} value={draft.combatLoadKg} onChange={(event) => setDraft({ ...draft, combatLoadKg: Number(event.target.value) })} /></label>
      </div>
      {carry && (
        <div className="ability-grid compact">
          <label>Extra boxes<input type="number" min={0} value={draft.carrySlots} onChange={(event) => setDraft({ ...draft, carrySlots: Number(event.target.value) })} /></label>
          <label>Weight %<input type="number" min={0} value={draft.carryReductionPercent} onChange={(event) => setDraft({ ...draft, carryReductionPercent: Number(event.target.value) })} /></label>
        </div>
      )}
      <label>Traits<textarea value={draft.traits} onChange={(event) => setDraft({ ...draft, traits: event.target.value })} placeholder="structured notes or special gear traits" /></label>
      <div className="split-actions">
        <button type="button" className="save-button" onClick={save}>Save</button>
        <button type="button" onClick={onClose}>Cancel</button>
      </div>
      {hasDraftContent() && <button type="button" className="gear-slot-trash" onClick={() => setClearPromptOpen(true)} aria-label="Clear gear slot" title="Clear gear slot"><Trash2 size={13} /></button>}
      {clearPromptOpen && (
        <div className="gear-save-prompt danger">
          <span>Clear this gear slot?</span>
          <button type="button" className="danger" onClick={() => { void clearItem(); }}>Clear</button>
          <button type="button" onClick={() => setClearPromptOpen(false)}>Cancel</button>
        </div>
      )}
      {savePromptOpen && (
        <div className="gear-save-prompt">
          <span>Save changes?</span>
          <button type="button" className="save-button" onClick={save}>Save</button>
          <button type="button" onClick={onClose}>Discard</button>
          <button type="button" onClick={() => setSavePromptOpen(false)}>Keep editing</button>
        </div>
      )}
    </div>
  );
}

function gearEffectLabel(value?: CharacterGearSlot) {
  if (!value) return "";
  return [
    value.dpBonus ? `${value.dpBonus > 0 ? "+" : ""}${value.dpBonus} DP` : "",
    value.apBonus ? `${value.apBonus > 0 ? "+" : ""}${value.apBonus} AP` : "",
    value.hpBonus ? `${value.hpBonus > 0 ? "+" : ""}${value.hpBonus} HP` : ""
  ].filter(Boolean).join(", ");
}

function useClosePromptOnOutsideClick(ref: RefObject<HTMLElement>, onOutside: () => void) {
  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && ref.current?.contains(target)) return;
      onOutside();
    }
    window.addEventListener("pointerdown", handlePointerDown, true);
    return () => window.removeEventListener("pointerdown", handlePointerDown, true);
  }, [ref, onOutside]);
}

function formatKg(value: number) {
  return `${Math.round(value * 10) / 10} kg`;
}

function formatCombatLoad(current: number, limit: number) {
  if (!limit) return "";
  if (current <= limit) return `${formatKg(current)} / ${formatKg(limit)}`;
  return `${formatKg(current)} / ${formatKg(limit)}`;
}
