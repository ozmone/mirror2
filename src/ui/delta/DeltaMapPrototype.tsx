import type React from "react";
import { useState } from "react";
import type { DeltaEntity, DeltaMapSize, DeltaMapTile } from "../../types";
import { entityDisplayNames, normaliseDeltaRelationship } from "./display";

export const deltaMapPreviewSizes = {
  S: { metres: 30, cells: 6 }, M: { metres: 50, cells: 10 }, L: { metres: 80, cells: 16 }, XL: { metres: 100, cells: 20 }, XXL: { metres: 200, cells: 40 }
} as const;

export function DeltaMapPrototype({ entities, tiles, size }: { entities: DeltaEntity[]; tiles: DeltaMapTile[]; size: DeltaMapSize }) {
  const { metres, cells } = deltaMapPreviewSizes[size];
  const mapGridWidth = 20 + cells * 22 + Math.max(0, cells - 1);
  const [selectedCell, setSelectedCell] = useState<{ row: number; column: number }>();
  const tilesByCoordinate = new Map(tiles.map((tile) => [`${tile.row}:${tile.column}`, tile]));
  const entitiesByCoordinate = new Map(entities.filter((entity) => Number.isInteger(entity.mapRow) && Number.isInteger(entity.mapColumn) && (entity.mapRow ?? 0) >= 1 && (entity.mapRow ?? 0) <= cells && (entity.mapColumn ?? 0) >= 1 && (entity.mapColumn ?? 0) <= cells).map((entity) => [`${entity.mapRow}:${entity.mapColumn}`, entity]));
  const displayNames = entityDisplayNames(entities);
  const selectedTile = selectedCell ? tilesByCoordinate.get(`${selectedCell.row}:${selectedCell.column}`) : undefined;
  const columns = Array.from({ length: cells }, (_, index) => String.fromCharCode(65 + (index % 26)));
  const selectedCoordinate = selectedCell ? `${columns[selectedCell.column - 1]}${selectedCell.row}` : "";
  const selectedTitle = selectedTile ? selectedTile.kind === "access" ? `${selectedTile.accessState === "locked" ? "Locked" : selectedTile.accessState === "open" ? "Open" : "Closed"} access` : selectedTile.kind === "special" ? selectedTile.label || "Special terrain" : selectedTile.kind === "half" ? selectedTile.label || "Half terrain" : selectedTile.label || "Solid terrain" : "Open tile";
  return (
    <div className="delta-map-prototype" style={{ "--map-grid-width": `${mapGridWidth}px` } as React.CSSProperties}>
      <div className="delta-map-header"><div><h2>Map</h2><small>{size} / {metres}m</small></div></div>
      <div className="delta-map-viewport">
        <div className="delta-map-corner" />
        <div className="delta-map-columns" style={{ gridTemplateColumns: `repeat(${cells}, var(--map-cell-size))` }}>{columns.map((column) => <span key={column}>{column}</span>)}</div>
        <div className="delta-map-rows">{Array.from({ length: cells }, (_, index) => <span key={index}>{index + 1}</span>)}</div>
        <div className="delta-map-grid" style={{ gridTemplateColumns: `repeat(${cells}, var(--map-cell-size))` }}>{Array.from({ length: cells * cells }, (_, index) => {
          const row = Math.floor(index / cells) + 1;
          const column = (index % cells) + 1;
          const tile = tilesByCoordinate.get(`${row}:${column}`);
          const entity = entitiesByCoordinate.get(`${row}:${column}`);
          const relationship = entity ? normaliseDeltaRelationship(entity.side) : "";
          const className = `delta-map-cell ${tile?.kind ?? "open"} ${relationship}${tile?.kind === "access" ? ` ${tile.accessState ?? "closed"}` : ""}${selectedCell?.row === row && selectedCell.column === column ? " selected" : ""}`;
          const style = tile?.kind === "special" && tile.color ? { "--terrain-color": tile.color } as React.CSSProperties : undefined;
          const title = entity ? displayNames.get(entity.id) ?? entity.name : tile?.label || (tile?.kind === "access" ? `${tile.accessState ?? "closed"} access` : tile?.kind ?? "open");
          return <button className={className} style={style} key={`${row}:${column}`} type="button" onClick={() => setSelectedCell({ row, column })} title={title}>{entity && <i>{(displayNames.get(entity.id) ?? entity.name).slice(0, 1).toUpperCase()}</i>}</button>;
        })}</div>
      </div>
      {selectedCell && <div className="delta-map-tile-detail"><small>{selectedCoordinate}</small><strong>{selectedTitle}</strong>{selectedTile?.label && selectedTile.kind !== "special" && <span>{selectedTile.label}</span>}{selectedTile?.kind === "special" && <span>Special terrain{selectedTile.color ? ` - ${selectedTile.color}` : ""}</span>}</div>}
      <div className="delta-map-key" aria-label="Map preview key"><span><i className="open" /> Open</span><span><i className="solid" /> Solid</span><span><i className="half" /> Half</span><span><i className="special" /> Special</span><span><i className="access closed" /> Closed access</span><span><i className="access open" /> Open access</span><span><i className="access locked" /> Locked access</span></div>
    </div>
  );
}
