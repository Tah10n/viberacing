"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import {
  formatAgentShare,
  formatCompactTokens,
  formatExactTokens,
} from "../../lib/leaderboard-format";
import type { LeaderboardRow } from "../../lib/leaderboard";
import { Badge } from "./ui";
import { RacerLink } from "./racer-link";
import { isProfileShortcut, shouldOpenProfile, syncProfileDialog } from "./standings-interaction";

interface StandingsTableProps {
  readonly currentHandle: string | undefined;
  readonly rows: readonly LeaderboardRow[];
}

function AgentMix({ row }: Readonly<{ row: LeaderboardRow }>) {
  return (
    <div className="agent-list">
      {row.breakdown.map((item) => (
        <span className="agent-stat" key={item.agent}>
          <span className="agent-chip">{item.label}</span>
          <span>{formatAgentShare(item.tokens, row.total)}</span>
        </span>
      ))}
    </div>
  );
}

interface RacerProfileDialogProps {
  readonly currentHandle: string | undefined;
  readonly onClose: () => void;
  readonly row: LeaderboardRow | null;
}

function RacerProfileDialog({ currentHandle, onClose, row }: RacerProfileDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    syncProfileDialog(dialog, row !== null);
  }, [row]);

  function closeFromBackdrop(event: MouseEvent<HTMLDialogElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const outside =
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom;
    if (outside) event.currentTarget.close();
  }

  return (
    <dialog
      aria-labelledby="racer-profile-title"
      className="racer-profile-dialog"
      onClick={closeFromBackdrop}
      onClose={onClose}
      ref={dialogRef}
    >
      {row === null ? null : (
        <div className="racer-profile-card">
          <div className="racer-profile-heading">
            <div>
              <span className="eyebrow">Racer profile</span>
              <h2 id="racer-profile-title">@{row.handle}</h2>
              <Badge>Self-reported</Badge>
            </div>
            <button
              aria-label="Close racer profile"
              className="dialog-close"
              onClick={() => dialogRef.current?.close()}
              type="button"
            >
              ×
            </button>
          </div>
          <div className="racer-profile-score">
            <div>
              <span>Weekly rank</span>
              <strong>#{row.rank}</strong>
            </div>
            <div>
              <span>Tokens this week</span>
              <strong title={`${formatExactTokens(row.total)} tokens`}>
                {formatCompactTokens(row.total)}
              </strong>
            </div>
          </div>
          <div className="racer-profile-agents" aria-label="Usage by agent">
            {row.breakdown.map((item) => (
              <div key={item.agent}>
                <span className="agent-chip">{item.label}</span>
                <span>{formatAgentShare(item.tokens, row.total)}</span>
                <strong title={`${formatExactTokens(item.tokens)} tokens`}>
                  {formatCompactTokens(item.tokens)}
                </strong>
              </div>
            ))}
          </div>
          <a
            className="button button-secondary racer-github-button"
            href={`https://github.com/${encodeURIComponent(row.handle)}`}
            rel="noreferrer"
            target="_blank"
          >
            Open GitHub profile ↗
          </a>
          {currentHandle?.toLowerCase() === row.handle.toLowerCase() ? (
            <span className="profile-you-label">This is your leaderboard profile</span>
          ) : null}
        </div>
      )}
    </dialog>
  );
}

export function StandingsTable({ currentHandle, rows }: StandingsTableProps) {
  const [selectedRow, setSelectedRow] = useState<LeaderboardRow | null>(null);
  const normalizedHandle = currentHandle?.toLowerCase();

  function openFromRow(event: MouseEvent<HTMLTableRowElement>, row: LeaderboardRow) {
    const isInteractiveTarget =
      event.target instanceof Element && event.target.closest("a, button") !== null;
    if (!shouldOpenProfile(isInteractiveTarget)) return;
    setSelectedRow(row);
  }

  function openFromKeyboard(event: KeyboardEvent<HTMLTableRowElement>, row: LeaderboardRow) {
    if (event.currentTarget !== event.target) return;
    if (!isProfileShortcut(event.key)) return;
    event.preventDefault();
    setSelectedRow(row);
  }

  return (
    <>
      <div className="table-scroll" tabIndex={0} aria-label="Scrollable weekly standings">
        <table className="ranking-table">
          <thead>
            <tr>
              <th scope="col">Pos</th>
              <th scope="col">Racer</th>
              <th scope="col">Agent mix</th>
              <th aria-sort="descending" scope="col">
                Tokens this week
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isCurrent = normalizedHandle === row.handle.toLowerCase();
              return (
                <tr
                  aria-haspopup="dialog"
                  aria-label={`@${row.handle}, rank ${row.rank}, ${formatCompactTokens(row.total)} tokens. Open leaderboard profile`}
                  className={isCurrent ? "current-racer" : undefined}
                  key={row.handle}
                  onClick={(event) => {
                    openFromRow(event, row);
                  }}
                  onKeyDown={(event) => {
                    openFromKeyboard(event, row);
                  }}
                  tabIndex={0}
                >
                  <td className="rank-cell">{row.rank}</td>
                  <td className="racer-cell">
                    <div className="racer-line">
                      <RacerLink handle={row.handle} />
                      {isCurrent ? <Badge>You</Badge> : null}
                    </div>
                    <div className="mobile-agent-mix">
                      <AgentMix row={row} />
                    </div>
                  </td>
                  <td>
                    <AgentMix row={row} />
                  </td>
                  <td className="token-cell" title={`${formatExactTokens(row.total)} tokens`}>
                    <strong>{formatCompactTokens(row.total)}</strong>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <RacerProfileDialog
        currentHandle={currentHandle}
        onClose={() => {
          setSelectedRow(null);
        }}
        row={selectedRow}
      />
    </>
  );
}
