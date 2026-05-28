import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { getSubModule } from "@/lib/modules";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { CalendarDays, ChevronLeft, MapPin, X } from "lucide-react";
import { TicketsMapWorkMap } from "@/components/TicketsMapWorkMap";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";

export function TicketsMap({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  return <TicketsMapWorkMap mod={mod} sub={sub} />;
}

export default TicketsMap;
                  </div>
                </div>

                <hr className="detail-divider" />

                <div className="detail-row">
                  <div className="detail-field grow">
                    <div className="detail-label">Contact</div>
                    <div className="detail-value">{selectedTicket.customer_cell_phone_1 || selectedTicket.phone || "-"}</div>
                    <div className="contact-actions">
                      <button className="contact-btn" type="button">Call</button>
                      <button className="contact-btn" type="button">Text</button>
                      <button className="contact-btn" type="button">Email</button>
                    </div>
                  </div>
                </div>

                <hr className="detail-divider" />

                <div className="detail-row">
                  <div className="detail-field grow">
                    <div className="detail-label">Internal Note</div>
                    <div className="internal-note-box">{selectedTicket.internal_note || selectedTicket.problem_description || "No internal note available."}</div>
                  </div>
                </div>
              </>
            ) : (
              <div className="text-sm text-slate-300">Select a ticket to view its details.</div>
            )}
          </div>
        </div>
      </div>

      <style>{`
        .map-panel { background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); border-radius: 10px; overflow: hidden; color: #fff; backdrop-filter: blur(10px); display: flex; flex-direction: column; }
        .map-topbar { display: flex; align-items: center; justify-content: center; gap: 1rem; padding: 0.65rem 1rem; background: rgba(17,24,39,0.75); border-bottom: 1px solid rgba(255,255,255,0.12); flex-wrap: wrap; position: relative; }
        .date-nav { display: flex; align-items: center; gap: 0.55rem; }
        .date-nav-btn { width: 32px; height: 32px; border-radius: 50%; border: 1px solid rgba(96,165,250,0.5); background: transparent; color: #60a5fa; font-size: 1.05rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; }
        #mapDate { background: rgba(15,23,42,0.85); border: 1.5px solid rgba(96,165,250,0.55); border-radius: 6px; color: #e2e8f0; font-size: 0.9rem; font-weight: 600; cursor: pointer; text-align: center; padding: 0.32rem 0.65rem; min-width: 130px; outline: none; }
        .topbar-label, .legend-caption { color: #94a3b8; font-size: 0.8rem; font-weight: 600; white-space: nowrap; }
        .legend-caption { font-size: 0.82rem; }
        .color-legend { display: flex; align-items: center; gap: 0.75rem; font-size: 0.85rem; position: absolute; right: 1rem; }
        .color-legend label { display: flex; align-items: center; gap: 0.3rem; cursor: pointer; color: #cbd5e1; }
        .map-body { display: flex; flex: 1; position: relative; min-height: 620px; }
        .ticket-sidebar { width: 230px; min-width: 200px; background: rgba(15,23,42,0.96); border-right: 1px solid rgba(255,255,255,0.1); display: flex; flex-direction: column; z-index: 10; }
        .sidebar-tabs { display: flex; border-bottom: 1px solid rgba(255,255,255,0.1); }
        .sidebar-tab { flex: 1; padding: 0.6rem; text-align: center; font-size: 0.85rem; font-weight: 600; cursor: pointer; border: none; background: transparent; color: #64748b; }
        .sidebar-tab.active { color: #fff; border-bottom: 2px solid #60a5fa; }
        .ticket-list { overflow-y: auto; flex: 1; display: none; }
        .ticket-list.visible { display: flex; flex-direction: column; }
        .ticket-card { display: flex; flex-direction: column; padding: 0.55rem 0.75rem; border-bottom: 1px solid rgba(255,255,255,0.07); cursor: pointer; border-left: 4px solid transparent; background: transparent; text-align: left; }
        .ticket-card:hover { background: rgba(255,255,255,0.05); }
        .ticket-card.selected { background: rgba(96,165,250,0.12); }
        .ticket-card-top { display: flex; justify-content: space-between; align-items: center; gap: 0.4rem; }
        .ticket-card-no { font-size: 0.8rem; font-weight: 700; color: #e2e8f0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .tech-badge, .status-pill-detail { font-size: 0.7rem; font-weight: 700; padding: 0.15rem 0.45rem; border-radius: 4px; white-space: nowrap; color: #fff; }
        .tone-ready { background: #3b82f6; } .tone-op { background: #f59e0b; } .tone-cl-need { background: #ef4444; } .tone-comp { background: #22c55e; }
        .tone-tech-0 { background: #2563eb; } .tone-tech-1 { background: #7c3aed; } .tone-tech-2 { background: #0f766e; } .tone-tech-3 { background: #b45309; } .tone-tech-4 { background: #be123c; } .tone-tech-5 { background: #4f46e5; }
        .ticket-card-addr { font-size: 0.74rem; color: #94a3b8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 0.2rem; }
        .status-view { padding: 0.75rem; display: none; flex-direction: column; gap: 0.5rem; }
        .status-view.visible { display: flex; }
        .status-row { display: flex; align-items: center; justify-content: space-between; font-size: 0.82rem; }
        .status-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; margin-right: 0.5rem; }
        .status-dot-ready { background: #3b82f6; } .status-dot-op { background: #f59e0b; } .status-dot-clNeed { background: #ef4444; } .status-dot-comp { background: #22c55e; }
        .map-area { flex: 1; position: relative; min-height: 500px; background: #d1e8d1; background-image: linear-gradient(rgba(0,0,0,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.06) 1px, transparent 1px); background-size: 48px 48px; overflow: hidden; }
        .map-area.satellite-mode { background: #1c2d1c; background-image: linear-gradient(rgba(0,255,0,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(0,255,0,0.04) 1px, transparent 1px); }
        .topbar-location-group { position: absolute; left: 1rem; top: 50%; transform: translateY(-50%); display: flex; align-items: center; gap: 0.4rem; z-index: 5; }
        .topbar-location-group select { background: rgba(15,23,42,0.9); border: 1px solid rgba(96,165,250,0.45); color: #e2e8f0; font-size: 0.78rem; font-weight: 600; padding: 0.3rem 0.55rem; border-radius: 4px; cursor: pointer; max-width: 180px; outline: none; }
        .map-type-toggle { position: absolute; top: 1rem; left: 1rem; border: 2px solid #9ca3af; border-radius: 4px; overflow: hidden; z-index: 5; display: flex; }
        .map-type-btn { padding: 0.42rem 0.85rem; font-size: 0.82rem; font-weight: 600; cursor: pointer; border: none; background: #f3f4f6; color: #1f2937; }
        .map-type-btn.active { background: #fff; box-shadow: inset 0 -2px 0 #3b82f6; }
        .map-placeholder-inner { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.75rem; pointer-events: none; }
        .map-placeholder-icon { opacity: 0.35; }
        .map-pins { position: absolute; inset: 0; pointer-events: none; }
        .map-pin { position: absolute; display: flex; flex-direction: column; align-items: center; cursor: pointer; pointer-events: all; transform: translate(-50%, -100%); background: transparent; border: none; padding: 0; }
        .map-pin:hover { transform: translate(-50%, -105%) scale(1.15); z-index: 10; }
        .pin-bubble { padding: 0.35rem 0.75rem; border-radius: 4px; font-size: 0.75rem; font-weight: 700; white-space: nowrap; box-shadow: 0 2px 8px rgba(0,0,0,0.35); display: flex; align-items: center; gap: 0.3rem; flex-direction: column; color: #fff; }
        .pin-initials { min-width: 1rem; line-height: 1; } .pin-time { font-size: 0.65rem; opacity: 0.9; line-height: 1; }
        .pin-tail { width: 0; height: 0; border-left: 5px solid transparent; border-right: 5px solid transparent; border-top: 8px solid transparent; margin-top: -1px; }
        .pin-tail.tone-ready { border-top-color: #3b82f6; } .pin-tail.tone-op { border-top-color: #f59e0b; } .pin-tail.tone-cl-need { border-top-color: #ef4444; } .pin-tail.tone-comp { border-top-color: #22c55e; }
        .pin-tail.tone-tech-0 { border-top-color: #2563eb; } .pin-tail.tone-tech-1 { border-top-color: #7c3aed; } .pin-tail.tone-tech-2 { border-top-color: #0f766e; } .pin-tail.tone-tech-3 { border-top-color: #b45309; } .pin-tail.tone-tech-4 { border-top-color: #be123c; } .pin-tail.tone-tech-5 { border-top-color: #4f46e5; }
        .selected-day-panel { position: absolute; top: 1rem; right: 1rem; width: 285px; background: rgba(10,15,30,0.97); border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; z-index: 20; overflow: hidden; }
        .selected-day-header { background: #0f172a; padding: 0.55rem 0.9rem; font-size: 0.88rem; font-weight: 700; color: #fff; border-bottom: 1px solid rgba(255,255,255,0.1); }
        .selected-day-filters { display: flex; gap: 0.6rem; padding: 0.55rem 0.85rem; flex-wrap: wrap; }
        .filter-chip { display: flex; align-items: center; gap: 0.3rem; font-size: 0.78rem; color: #e2e8f0; cursor: pointer; }
        .detail-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.55); z-index: 200; display: none; align-items: center; justify-content: center; padding: 1rem; }
        .detail-overlay.open { display: flex; }
        .detail-modal { background: #1e293b; border: 1px solid rgba(255,255,255,0.15); border-radius: 10px; width: 700px; max-width: 95vw; max-height: 92vh; overflow-y: auto; color: #f1f5f9; box-shadow: 0 20px 60px rgba(0,0,0,0.6); }
        .detail-modal-header { display: flex; justify-content: space-between; align-items: center; padding: 0.85rem 1.1rem; background: #0f172a; border-bottom: 1px solid rgba(255,255,255,0.1); position: sticky; top: 0; z-index: 1; }
        .detail-title-row { display: flex; align-items: center; gap: 0.75rem; }
        .detail-ticket-no { font-size: 1.1rem; font-weight: 700; color: #fff; }
        .detail-ticket-link { text-decoration: underline; text-underline-offset: 2px; } .detail-ticket-link:hover { color: #93c5fd; }
        .google-btn { padding: 0.28rem 0.7rem; background: #4285f4; color: #fff; border: none; border-radius: 4px; font-size: 0.76rem; font-weight: 600; cursor: pointer; }
        .modal-close-btn { background: transparent; border: none; color: #64748b; font-size: 1.4rem; cursor: pointer; line-height: 1; padding: 0.1rem 0.3rem; }
        .detail-body { padding: 1rem 1.1rem; }
        .detail-row { display: flex; gap: 1.5rem; margin-bottom: 0.65rem; flex-wrap: wrap; align-items: flex-start; }
        .detail-field { display: flex; flex-direction: column; gap: 0.22rem; min-width: 130px; } .detail-field.grow { flex: 1; }
        .detail-label { font-size: 0.72rem; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em; }
        .detail-value { font-size: 0.9rem; color: #f1f5f9; }
        .detail-divider { border: none; border-top: 1px solid rgba(255,255,255,0.08); margin: 0.8rem 0; }
        .schedule-box { display: inline-flex; align-items: center; gap: 0.55rem; background: rgba(30,64,175,0.2); border: 1px solid rgba(96,165,250,0.3); border-radius: 6px; padding: 0.45rem 0.85rem; font-size: 0.88rem; flex-wrap: wrap; }
        .contact-actions { display: flex; flex-wrap: wrap; gap: 0.45rem; margin-top: 0.45rem; }
        .contact-btn { padding: 0.28rem 0.7rem; border-radius: 4px; border: 1px solid rgba(255,255,255,0.18); background: rgba(30,41,59,0.9); color: #e2e8f0; font-size: 0.76rem; cursor: pointer; }
        .contact-btn:hover { background: rgba(30,64,175,0.3); border-color: rgba(96,165,250,0.4); }
        .status-pill-detail { display: inline-block; padding: 0.25rem 0.7rem; border-radius: 99px; font-size: 0.8rem; font-weight: 600; color: #fff; }
        .internal-note-box { font-size: 0.82rem; color: #cbd5e1; background: rgba(15,23,42,0.6); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; padding: 0.65rem 0.9rem; line-height: 1.65; white-space: pre-wrap; width: 100%; box-sizing: border-box; }
        .selected-day-panel, .map-panel, .ticket-sidebar, .detail-modal { animation: fadeIn 180ms ease-out; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
        @media (max-width: 768px) { .ticket-sidebar { width: 175px; min-width: 150px; } .color-legend { position: static; right: auto; } .selected-day-panel { width: 220px; } .map-body { min-height: 480px; } }
      `}</style>
      <style>{pinStyles}</style>
    </div>
  );
}
import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { getSubModule } from "@/lib/modules";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { CalendarDays, ChevronLeft, MapPin, X } from "lucide-react";

type ColorMode = "status" | "tech";
type SidebarTab = "tickets" | "status";

interface LocationTickets {
  location: string;
  count: number;
  records: any[];
  priority: "high" | "medium" | "low";
}

const FALLBACK_LOCATIONS = [
  "Asheville",
  "Atlanta",
  "Birmingham",
  "Cape Girardeau",
  "Chattanooga",
  "Columbus",
  "Dallas",
  "Destin",
  "Huntsville",
  "Jackson,MS",
  "Jackson, TN",
  "Jacksonville",
  "Jonesboro",
  "Knoxville",
  "Lake Charles",
  "Little Rock",
                </div>
              </section>
            </div>
          </div>
        )}
      </main>

      <div className={`detail-overlay ${selectedTicket ? "open" : ""}`}>
        <div className="detail-modal">
          <div className="detail-modal-header">
            <div className="detail-title-row">
              <a className="detail-ticket-no detail-ticket-link" href={selectedTicket ? "ticket_details.html" : "#"} target="_blank" rel="noopener noreferrer">
                {selectedTicket?.ticket_no || "Ticket details"}
              </a>
              <button className="google-btn" type="button" onClick={() => selectedTicket && window.open(`https://www.google.com/search?q=${encodeURIComponent(selectedTicket.ticket_no || selectedTicket.customer_name || "ticket")}`, "_blank", "noopener,noreferrer")}>Google</button>
            </div>
            <button className="modal-close-btn" type="button" aria-label="Close" onClick={() => setSelectedTicket(null)}><X className="h-5 w-5" /></button>
          </div>

          <div className="detail-body">
            {selectedTicket ? (
              <>
                <div className="detail-row">
                  <div className="detail-field grow">
                    <div className="detail-label">Customer</div>
                    <div className="detail-value">{selectedTicket.customer_name || selectedTicket.customer || "Unknown"}</div>
                  </div>
                  <div className="detail-field">
                    <div className="detail-label">Technician</div>
                    <div className="detail-value">{selectedTicket.technician_name || selectedTicket.technician || "Unassigned"}</div>
                  </div>
                  <div className="detail-field">
                    <div className="detail-label">Status</div>
                    <div className="detail-value"><span className={`status-pill-detail ${getToneClass(colorMode, selectedTicket, 0)}`}>{selectedTicket.status || "Open"}</span></div>
                  </div>
                </div>

                <hr className="detail-divider" />

                <div className="detail-row">
                  <div className="detail-field grow">
                    <div className="detail-label">Address</div>
                    <div className="detail-value">{selectedTicket.customer_address || selectedTicket.location || selectedTicket.customer_city || "-"}</div>
                  </div>
                  <div className="detail-field">
                    <div className="detail-label">Schedule</div>
                    <div className="detail-value"><span className="schedule-box"><CalendarDays className="h-4 w-4" /><span>{String(selectedTicket.schedule || selectedTicket.schedule_date || mapDate)}</span></span></div>
                  </div>
                </div>

                <div className="detail-row">
                  <div className="detail-field grow">
                    <div className="detail-label">Problem</div>
                    <div className="detail-value">{selectedTicket.problem_description || selectedTicket.note || "No additional notes."}</div>
                  </div>
                </div>

                <hr className="detail-divider" />

                <div className="detail-row">
                  <div className="detail-field grow">
                    <div className="detail-label">Contact</div>
                    <div className="detail-value">{selectedTicket.customer_cell_phone_1 || selectedTicket.phone || "-"}</div>
                    <div className="contact-actions">
                      <button className="contact-btn" type="button">Call</button>
                      <button className="contact-btn" type="button">Text</button>
                      <button className="contact-btn" type="button">Email</button>
                    </div>
                  </div>
                </div>

                <hr className="detail-divider" />

                <div className="detail-row">
                  <div className="detail-field grow">
                    <div className="detail-label">Internal Note</div>
                    <div className="internal-note-box">{selectedTicket.internal_note || selectedTicket.problem_description || "No internal note available."}</div>
                  </div>
                </div>
              </>
            ) : (
              <div className="text-sm text-slate-300">Select a ticket to view its details.</div>
            )}
          </div>
        </div>
      </div>

      <style>{`
        .map-panel { background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); border-radius: 10px; overflow: hidden; color: #fff; backdrop-filter: blur(10px); display: flex; flex-direction: column; }
        .map-topbar { display: flex; align-items: center; justify-content: center; gap: 1rem; padding: 0.65rem 1rem; background: rgba(17,24,39,0.75); border-bottom: 1px solid rgba(255,255,255,0.12); flex-wrap: wrap; position: relative; }
        .date-nav { display: flex; align-items: center; gap: 0.55rem; }
        .date-nav-btn { width: 32px; height: 32px; border-radius: 50%; border: 1px solid rgba(96,165,250,0.5); background: transparent; color: #60a5fa; font-size: 1.05rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; }
        #mapDate { background: rgba(15,23,42,0.85); border: 1.5px solid rgba(96,165,250,0.55); border-radius: 6px; color: #e2e8f0; font-size: 0.9rem; font-weight: 600; cursor: pointer; text-align: center; padding: 0.32rem 0.65rem; min-width: 130px; outline: none; }
        .topbar-label, .legend-caption { color: #94a3b8; font-size: 0.8rem; font-weight: 600; white-space: nowrap; }
        .legend-caption { font-size: 0.82rem; }
        .color-legend { display: flex; align-items: center; gap: 0.75rem; font-size: 0.85rem; position: absolute; right: 1rem; }
        .color-legend label { display: flex; align-items: center; gap: 0.3rem; cursor: pointer; color: #cbd5e1; }
        .map-body { display: flex; flex: 1; position: relative; min-height: 620px; }
        .ticket-sidebar { width: 230px; min-width: 200px; background: rgba(15,23,42,0.96); border-right: 1px solid rgba(255,255,255,0.1); display: flex; flex-direction: column; z-index: 10; }
        .sidebar-tabs { display: flex; border-bottom: 1px solid rgba(255,255,255,0.1); }
        .sidebar-tab { flex: 1; padding: 0.6rem; text-align: center; font-size: 0.85rem; font-weight: 600; cursor: pointer; border: none; background: transparent; color: #64748b; }
        .sidebar-tab.active { color: #fff; border-bottom: 2px solid #60a5fa; }
        .ticket-list { overflow-y: auto; flex: 1; display: none; }
        .ticket-list.visible { display: flex; flex-direction: column; }
        .ticket-card { display: flex; flex-direction: column; padding: 0.55rem 0.75rem; border-bottom: 1px solid rgba(255,255,255,0.07); cursor: pointer; border-left: 4px solid transparent; background: transparent; text-align: left; }
        .ticket-card:hover { background: rgba(255,255,255,0.05); }
        .ticket-card.selected { background: rgba(96,165,250,0.12); }
        .ticket-card-top { display: flex; justify-content: space-between; align-items: center; gap: 0.4rem; }
        .ticket-card-no { font-size: 0.8rem; font-weight: 700; color: #e2e8f0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .tech-badge, .status-pill-detail { font-size: 0.7rem; font-weight: 700; padding: 0.15rem 0.45rem; border-radius: 4px; white-space: nowrap; color: #fff; }
        .tone-ready { background: #3b82f6; } .tone-op { background: #f59e0b; } .tone-cl-need { background: #ef4444; } .tone-comp { background: #22c55e; }
        .tone-tech-0 { background: #2563eb; } .tone-tech-1 { background: #7c3aed; } .tone-tech-2 { background: #0f766e; } .tone-tech-3 { background: #b45309; } .tone-tech-4 { background: #be123c; } .tone-tech-5 { background: #4f46e5; }
        .ticket-card-addr { font-size: 0.74rem; color: #94a3b8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 0.2rem; }
        .status-view { padding: 0.75rem; display: none; flex-direction: column; gap: 0.5rem; }
        .status-view.visible { display: flex; }
        .status-row { display: flex; align-items: center; justify-content: space-between; font-size: 0.82rem; }
        .status-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; margin-right: 0.5rem; }
        .status-dot-ready { background: #3b82f6; } .status-dot-op { background: #f59e0b; } .status-dot-clNeed { background: #ef4444; } .status-dot-comp { background: #22c55e; }
        .map-area { flex: 1; position: relative; min-height: 500px; background: #d1e8d1; background-image: linear-gradient(rgba(0,0,0,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.06) 1px, transparent 1px); background-size: 48px 48px; overflow: hidden; }
        .map-area.satellite-mode { background: #1c2d1c; background-image: linear-gradient(rgba(0,255,0,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(0,255,0,0.04) 1px, transparent 1px); }
        .topbar-location-group { position: absolute; left: 1rem; top: 50%; transform: translateY(-50%); display: flex; align-items: center; gap: 0.4rem; z-index: 5; }
        .topbar-location-group select { background: rgba(15,23,42,0.9); border: 1px solid rgba(96,165,250,0.45); color: #e2e8f0; font-size: 0.78rem; font-weight: 600; padding: 0.3rem 0.55rem; border-radius: 4px; cursor: pointer; max-width: 180px; outline: none; }
        .map-type-toggle { position: absolute; top: 1rem; left: 1rem; border: 2px solid #9ca3af; border-radius: 4px; overflow: hidden; z-index: 5; display: flex; }
        .map-type-btn { padding: 0.42rem 0.85rem; font-size: 0.82rem; font-weight: 600; cursor: pointer; border: none; background: #f3f4f6; color: #1f2937; }
        .map-type-btn.active { background: #fff; box-shadow: inset 0 -2px 0 #3b82f6; }
        .map-placeholder-inner { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.75rem; pointer-events: none; }
        .map-placeholder-icon { opacity: 0.35; }
        .map-pins { position: absolute; inset: 0; pointer-events: none; }
        .map-pin { position: absolute; display: flex; flex-direction: column; align-items: center; cursor: pointer; pointer-events: all; transform: translate(-50%, -100%); background: transparent; border: none; padding: 0; }
        .map-pin:hover { transform: translate(-50%, -105%) scale(1.15); z-index: 10; }
        .pin-bubble { padding: 0.35rem 0.75rem; border-radius: 4px; font-size: 0.75rem; font-weight: 700; white-space: nowrap; box-shadow: 0 2px 8px rgba(0,0,0,0.35); display: flex; align-items: center; gap: 0.3rem; flex-direction: column; color: #fff; }
        .pin-initials { min-width: 1rem; line-height: 1; } .pin-time { font-size: 0.65rem; opacity: 0.9; line-height: 1; }
        .pin-tail { width: 0; height: 0; border-left: 5px solid transparent; border-right: 5px solid transparent; border-top: 8px solid transparent; margin-top: -1px; }
        .pin-tail.tone-ready { border-top-color: #3b82f6; } .pin-tail.tone-op { border-top-color: #f59e0b; } .pin-tail.tone-cl-need { border-top-color: #ef4444; } .pin-tail.tone-comp { border-top-color: #22c55e; }
        .pin-tail.tone-tech-0 { border-top-color: #2563eb; } .pin-tail.tone-tech-1 { border-top-color: #7c3aed; } .pin-tail.tone-tech-2 { border-top-color: #0f766e; } .pin-tail.tone-tech-3 { border-top-color: #b45309; } .pin-tail.tone-tech-4 { border-top-color: #be123c; } .pin-tail.tone-tech-5 { border-top-color: #4f46e5; }
        .selected-day-panel { position: absolute; top: 1rem; right: 1rem; width: 285px; background: rgba(10,15,30,0.97); border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; z-index: 20; overflow: hidden; }
        .selected-day-header { background: #0f172a; padding: 0.55rem 0.9rem; font-size: 0.88rem; font-weight: 700; color: #fff; border-bottom: 1px solid rgba(255,255,255,0.1); }
        .selected-day-filters { display: flex; gap: 0.6rem; padding: 0.55rem 0.85rem; flex-wrap: wrap; }
        .filter-chip { display: flex; align-items: center; gap: 0.3rem; font-size: 0.78rem; color: #e2e8f0; cursor: pointer; }
        .detail-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.55); z-index: 200; display: none; align-items: center; justify-content: center; padding: 1rem; }
        .detail-overlay.open { display: flex; }
        .detail-modal { background: #1e293b; border: 1px solid rgba(255,255,255,0.15); border-radius: 10px; width: 700px; max-width: 95vw; max-height: 92vh; overflow-y: auto; color: #f1f5f9; box-shadow: 0 20px 60px rgba(0,0,0,0.6); }
        .detail-modal-header { display: flex; justify-content: space-between; align-items: center; padding: 0.85rem 1.1rem; background: #0f172a; border-bottom: 1px solid rgba(255,255,255,0.1); position: sticky; top: 0; z-index: 1; }
        .detail-title-row { display: flex; align-items: center; gap: 0.75rem; }
        .detail-ticket-no { font-size: 1.1rem; font-weight: 700; color: #fff; }
        .detail-ticket-link { text-decoration: underline; text-underline-offset: 2px; } .detail-ticket-link:hover { color: #93c5fd; }
        .google-btn { padding: 0.28rem 0.7rem; background: #4285f4; color: #fff; border: none; border-radius: 4px; font-size: 0.76rem; font-weight: 600; cursor: pointer; }
        .modal-close-btn { background: transparent; border: none; color: #64748b; font-size: 1.4rem; cursor: pointer; line-height: 1; padding: 0.1rem 0.3rem; }
        .detail-body { padding: 1rem 1.1rem; }
        .detail-row { display: flex; gap: 1.5rem; margin-bottom: 0.65rem; flex-wrap: wrap; align-items: flex-start; }
        .detail-field { display: flex; flex-direction: column; gap: 0.22rem; min-width: 130px; } .detail-field.grow { flex: 1; }
        .detail-label { font-size: 0.72rem; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em; }
        .detail-value { font-size: 0.9rem; color: #f1f5f9; }
        .detail-divider { border: none; border-top: 1px solid rgba(255,255,255,0.08); margin: 0.8rem 0; }
        .schedule-box { display: inline-flex; align-items: center; gap: 0.55rem; background: rgba(30,64,175,0.2); border: 1px solid rgba(96,165,250,0.3); border-radius: 6px; padding: 0.45rem 0.85rem; font-size: 0.88rem; flex-wrap: wrap; }
        .contact-actions { display: flex; flex-wrap: wrap; gap: 0.45rem; margin-top: 0.45rem; }
        .contact-btn { padding: 0.28rem 0.7rem; border-radius: 4px; border: 1px solid rgba(255,255,255,0.18); background: rgba(30,41,59,0.9); color: #e2e8f0; font-size: 0.76rem; cursor: pointer; }
        .contact-btn:hover { background: rgba(30,64,175,0.3); border-color: rgba(96,165,250,0.4); }
        .status-pill-detail { display: inline-block; padding: 0.25rem 0.7rem; border-radius: 99px; font-size: 0.8rem; font-weight: 600; color: #fff; }
        .internal-note-box { font-size: 0.82rem; color: #cbd5e1; background: rgba(15,23,42,0.6); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; padding: 0.65rem 0.9rem; line-height: 1.65; white-space: pre-wrap; width: 100%; box-sizing: border-box; }
        .selected-day-panel, .map-panel, .ticket-sidebar, .detail-modal { animation: fadeIn 180ms ease-out; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
        @media (max-width: 768px) { .ticket-sidebar { width: 175px; min-width: 150px; } .color-legend { position: static; right: auto; } .selected-day-panel { width: 220px; } .map-body { min-height: 480px; } }
      `}</style>
      <style>{pinStyles}</style>
    </div>
  );
}import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { getSubModule } from "@/lib/modules";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { CalendarDays, ChevronLeft, MapPin, X } from "lucide-react";

type ColorMode = "status" | "tech";
type SidebarTab = "tickets" | "status";

interface LocationTickets {
  location: string;
  count: number;
  records: any[];
  priority: "high" | "medium" | "low";
}

const FALLBACK_LOCATIONS = [
  "Asheville",
  "Atlanta",
  "Birmingham",
  "Cape Girardeau",
  "Chattanooga",
  "Columbus",
  "Dallas",
  "Destin",
  "Huntsville",
  "Jackson,MS",
  "Jackson, TN",
  "Jacksonville",
  "Jonesboro",
  "Knoxville",
  "Lake Charles",
  "Little Rock",
  "Louisville",
  "Memphis",
  "Mobile",
  "Montgomery",
  "Nashville",
  "New Orleans",
  "Norfolk",
  "Philippines",
  "Raleigh",
  "Richmond",
  "San Antonio",
  "Savannah",
  "St. Louis",
  "Tallanassee",
  "Wilmington",
].sort();

function normalizeLocationName(location: string) {
  return String(location || "").trim().replace(/\s*,\s*/g, ", ");
}

function derivePriority(records: any[]): "high" | "medium" | "low" {
  const highPriority = records.filter((record) => String(record.priority || "").toLowerCase() === "high").length;
  if (highPriority > 0) return "high";
  if (records.length > 3) return "medium";
  return "low";
}

function deriveStatusGroup(status: string) {
  const value = String(status || "").toLowerCase();
  if (value.includes("complet") || value.includes("closed") || value === "comp") return "comp";
  if (value.startsWith("cl-")) return "cl-need";
  if (value.includes("ready")) return "ready";
  return "op";
}

function getInitials(value: string | null | undefined) {
  if (!value) return "U";
  const localPart = value.split("@")[0] ?? value;
  const parts = localPart.split(/[._-]/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return localPart.slice(0, 2).toUpperCase();
}

function getTicketToneClass(mode: ColorMode, ticket: any, index: number) {
  if (mode === "tech") {
    return `tone-tech-${index % 6}`;
  }

  const status = String(ticket.status || "").toLowerCase();
  if (status.includes("closed") || status.includes("comp")) return "tone-comp";
  if (status.startsWith("cl-") || status.includes("part")) return "tone-cl-need";
  if (status.includes("ready")) return "tone-ready";
  return "tone-op";
}

function getStatusDotClass(status: "ready" | "op" | "clNeed" | "comp") {
  if (status === "ready") return "status-dot status-dot-ready";
  if (status === "clNeed") return "status-dot status-dot-cl-need";
  if (status === "comp") return "status-dot status-dot-comp";
  return "status-dot status-dot-op";
}

function buildPinPosition(ticket: any, index: number) {
  const base = String(ticket.location || ticket.customer || ticket.city || ticket.address || "");
  let hash = 0;
  for (let i = 0; i < base.length; i += 1) {
    hash = (hash * 31 + base.charCodeAt(i)) % 100000;
  }
  const x = 10 + ((hash + index * 17) % 78);
  const y = 15 + (((hash >> 3) + index * 11) % 68);
  return { left: `${x}%`, top: `${y}%` };
}

export function TicketsMap({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const [selectedLocation, setSelectedLocation] = useState<string>("");
  const [selectedTicket, setSelectedTicket] = useState<any | null>(null);
  const [colorMode, setColorMode] = useState<ColorMode>("status");
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("tickets");
  const [mapMode, setMapMode] = useState<"map" | "satellite">("map");
  const [mapDate, setMapDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const key = "ticket-list";
    const existing = localStorage.getItem(key);
    if (!existing) {
      const seeded = getSubModule("tickets", "ticket-list");
      if (seeded?.seed) {
        const count = seeded.count || 24;
        const data = Array.from({ length: count }, (_, index) => seeded.seed(index));
        localStorage.setItem(key, JSON.stringify(data));
      }
    }
    setIsReady(true);
  }, []);

  const tickets = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("ticket-list") || "[]") as any[];
    } catch {
      return [];
    }
  }, [isReady]);

  const locationData: LocationTickets[] = useMemo(() => {
    const locationMap = new Map<string, any[]>();
    tickets.forEach((ticket) => {
      const location = normalizeLocationName(ticket.location || ticket.customer_city || ticket.city || "Richmond, VA");
      if (!locationMap.has(location)) locationMap.set(location, []);
      locationMap.get(location)!.push(ticket);
    });

    return Array.from(locationMap.entries())
      .map(([location, records]) => ({ location, count: records.length, records, priority: derivePriority(records) }))
      .sort((a, b) => b.count - a.count);
  }, [tickets]);

  useEffect(() => {
    if (!selectedLocation && locationData.length > 0) {
      setSelectedLocation(locationData[0].location);
    }
  }, [locationData, selectedLocation]);

  const visibleTickets = useMemo(() => {
    const filtered = selectedLocation
      ? tickets.filter((ticket) => normalizeLocationName(ticket.location || ticket.customer_city || ticket.city || "Richmond, VA") === selectedLocation)
      : tickets;

    return filtered.filter((ticket) => {
      const ticketDate = String(ticket.schedule || ticket.created || ticket.created_at || "").slice(0, 10);
      return !ticketDate || ticketDate === mapDate;
    });
  }, [tickets, selectedLocation, mapDate]);

  const selectedLocationData = locationData.find((location) => location.location === selectedLocation) || null;

  const counters = useMemo(() => {
    const source = selectedLocationData?.records ?? tickets;
    return source.reduce(
      (acc, ticket) => {
        const group = deriveStatusGroup(ticket.status);
        if (group === "ready") acc.ready += 1;
        if (group === "op") acc.op += 1;
        if (group === "cl-need") acc.clNeed += 1;
        if (group === "comp") acc.comp += 1;
        return acc;
      },
      { ready: 0, op: 0, clNeed: 0, comp: 0 },
    );
  }, [selectedLocationData, tickets]);

  const filteredPins = visibleTickets.filter((ticket) => {
    const ticketDate = String(ticket.schedule || ticket.created || ticket.created_at || "").slice(0, 10);
    return !ticketDate || ticketDate === mapDate;
  });

  const pinStyleRules = useMemo(
    () =>
      filteredPins
        .map((ticket, index) => {
          const position = buildPinPosition(ticket, index);
          return `.map-pin-${index} { left: ${position.left}; top: ${position.top}; }`;
        })
        .join("\n"),
    [filteredPins],
  );

  const currentTicket = selectedTicket;

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1400px] mx-auto w-full px-6 py-8">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-6">
            <Link to="/m/$module" params={{ module: mod.slug }} className="btn hover:bg-white/15">
              <ChevronLeft className="h-4 w-4" /> {mod.label}
            </Link>
          </div>
          <div>
            <h1 className="text-4xl font-display font-bold tracking-tight mb-2">{sub.title}</h1>
          font-size: 0.76rem;
          cursor: pointer;
          transition: background 0.15s;
        }

        .contact-btn:hover {
          background: rgba(30, 64, 175, 0.3);
          border-color: rgba(96, 165, 250, 0.4);
        }

        .status-pill-detail {
          display: inline-block;
          padding: 0.25rem 0.7rem;
          border-radius: 99px;
          font-size: 0.8rem;
          font-weight: 600;
        }

        .internal-note-box {
          font-size: 0.82rem;
          color: #cbd5e1;
          background: rgba(15, 23, 42, 0.6);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 6px;
          padding: 0.65rem 0.9rem;
          line-height: 1.65;
          white-space: pre-wrap;
          width: 100%;
          box-sizing: border-box;
        }

        @media (max-width: 768px) {
          .ticket-sidebar {
            width: 175px;
            min-width: 150px;
          }

          .color-legend {
            position: static;
            right: auto;
          }

          .selected-day-panel {
            width: 220px;
          }

          .map-body {
            min-height: 480px;
          }
        }
      `}</style>
      <style>{pinStyleRules}</style>
    </div>
  );
}}

            <div className="map-body">
              <div className="ticket-sidebar">
                <div className="sidebar-tabs">
                  <button className={`sidebar-tab ${sidebarTab === "status" ? "active" : ""}`} type="button" onClick={() => setSidebarTab("status")}>Status</button>
                  <button className={`sidebar-tab ${sidebarTab === "tickets" ? "active" : ""}`} type="button" onClick={() => setSidebarTab("tickets")}>Tickets</button>
                </div>

                <div className={`status-view ${sidebarTab === "status" ? "visible" : ""}`}>
                  <div className="status-row">
                    <span><span className={getStatusDotClass("ready")} />Ready for Service</span>
                    <span>{counters.ready}</span>
                  </div>
                  <div className="status-row">
                    <span><span className={getStatusDotClass("op")} />OP - Reschedule</span>
                    <span>{counters.op}</span>
                  </div>
                  <div className="status-row">
                    <span><span className={getStatusDotClass("clNeed")} />CL - Need Parts</span>
                    <span>{counters.clNeed}</span>
                  </div>
                  <div className="status-row">
                    <span><span className={getStatusDotClass("comp")} />Completed</span>
                    <span>{counters.comp}</span>
                  </div>
                </div>

                <div className={`ticket-list ${sidebarTab === "tickets" ? "visible" : ""}`}>
                  {visibleTickets.length === 0 ? (
                    <div className="p-4 text-sm text-slate-400">No tickets for this location/date.</div>
                  ) : (
                    visibleTickets.map((ticket, index) => {
                      const selected = currentTicket?.ticket_no === ticket.ticket_no;
                      const toneClass = getTicketToneClass(colorMode, ticket, index);
                      return (
                        <button
                          key={`${ticket.ticket_no}-${index}`}
                          type="button"
                          className={`ticket-card ${selected ? "selected" : ""}`}
                          onClick={() => setSelectedTicket(ticket)}
                        >
                          <div className="ticket-card-top">
                            <span className="ticket-card-no">{ticket.ticket_no}</span>
                            <span className={`tech-badge ${toneClass}`}>{ticket.technician_name || ticket.technician || "Unassigned"}</span>
                          </div>
                          <span className="ticket-card-addr">{ticket.customer_address || ticket.customer_name || ticket.customer_city || ticket.location || "Unknown address"}</span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              <div className={`map-area ${mapMode === "satellite" ? "satellite-mode" : ""}`} id="mapArea">
                <div className="map-type-toggle">
                  <button className={`map-type-btn ${mapMode === "map" ? "active" : ""}`} type="button" onClick={() => setMapMode("map")}>Map</button>
                  <button className={`map-type-btn ${mapMode === "satellite" ? "active" : ""}`} type="button" onClick={() => setMapMode("satellite")}>Satellite</button>
                </div>

                <div className="map-placeholder-inner">
                  <MapPin className="map-placeholder-icon h-16 w-16 text-slate-600" />
                  <div className="text-sm text-slate-500">Map view is rendered from the ticket data below.</div>
                </div>

                <div className="map-pins">
                  {filteredPins.map((ticket, index) => {
                    const toneClass = getTicketToneClass(colorMode, ticket, index);
                    const initials = getInitials(ticket.technician_name || ticket.technician || ticket.customer_name || ticket.ticket_no);
                    const time = String(ticket.schedule || ticket.created || ticket.created_at || "").slice(11, 16) || ticket.schedule_date || "";
                    return (
                      <button
                        key={`pin-${ticket.ticket_no}-${index}`}
                        type="button"
                        className={`map-pin map-pin-${index}`}
                        onClick={() => setSelectedTicket(ticket)}
                        aria-label={`Open ${ticket.ticket_no}`}
                      >
                        <div className={`pin-bubble ${toneClass}`}>
                          <span className="pin-initials">{initials}</span>
                          <span className="pin-time">{time || "Today"}</span>
                        </div>
                        <div className={`pin-tail ${toneClass}`} />
                      </button>
                    );
                  })}
                </div>

                <div className="selected-day-panel">
                  <div className="selected-day-header">Selected Day's Tickets</div>
                  <div className="selected-day-filters">
                    <label className="filter-chip">
                      <input type="checkbox" defaultChecked /> Technician
                    </label>
                    <label className="filter-chip">
                      <input type="checkbox" defaultChecked /> Ready
                    </label>
                    <label className="filter-chip">
                      <input type="checkbox" defaultChecked /> CL-Need
                    </label>
                    <label className="filter-chip">
                      <input type="checkbox" defaultChecked /> Comp.
                    </label>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      <div className={`detail-overlay ${currentTicket ? "open" : ""}`}>
        <div className="detail-modal">
          <div className="detail-modal-header">
            <div className="detail-title-row">
              <a
                className="detail-ticket-no detail-ticket-link"
                href={currentTicket ? "ticket_details.html" : "#"}
                title="Open ticket details"
                target="_blank"
                rel="noopener noreferrer"
              >
                {currentTicket?.ticket_no || "Ticket details"}
              </a>
              <button className="google-btn" type="button" onClick={() => currentTicket && window.open(`https://www.google.com/search?q=${encodeURIComponent(currentTicket.ticket_no || currentTicket.customer_name || "ticket")}`, "_blank", "noopener,noreferrer")}>Google</button>
            </div>
            <button className="modal-close-btn" type="button" aria-label="Close" onClick={() => setSelectedTicket(null)}>
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="detail-body">
            {currentTicket ? (
              <>
                <div className="detail-row">
                  <div className="detail-field grow">
                    <div className="detail-label">Customer</div>
                    <div className="detail-value">{currentTicket.customer_name || currentTicket.customer || "Unknown"}</div>
                  </div>
                  <div className="detail-field">
                    <div className="detail-label">Technician</div>
                    <div className="detail-value">{currentTicket.technician_name || currentTicket.technician || "Unassigned"}</div>
                  </div>
                  <div className="detail-field">
                    <div className="detail-label">Status</div>
                    <div className="detail-value">
                      <span className={`status-pill-detail ${getTicketToneClass(colorMode, currentTicket, 0)}`}>
                        {currentTicket.status || "Open"}
                      </span>
                    </div>
                  </div>
                </div>

                <hr className="detail-divider" />

                <div className="detail-row">
                  <div className="detail-field grow">
                    <div className="detail-label">Address</div>
                    <div className="detail-value">{currentTicket.customer_address || currentTicket.location || currentTicket.customer_city || "-"}</div>
                  </div>
                  <div className="detail-field">
                    <div className="detail-label">Schedule</div>
                    <div className="detail-value">
                      <span className="schedule-box">
                        <CalendarDays className="h-4 w-4" />
                        <span>{String(currentTicket.schedule || currentTicket.schedule_date || mapDate)}</span>
                      </span>
                    </div>
                  </div>
                </div>

                <div className="detail-row">
                  <div className="detail-field grow">
                    <div className="detail-label">Problem</div>
                    <div className="detail-value">{currentTicket.problem_description || currentTicket.note || "No additional notes."}</div>
                  </div>
                </div>

                <hr className="detail-divider" />

                <div className="detail-row">
                  <div className="detail-field grow">
                    <div className="detail-label">Contact</div>
                    <div className="detail-value">{currentTicket.customer_cell_phone_1 || currentTicket.phone || "-"}</div>
                    <div className="contact-actions">
                      <button className="contact-btn" type="button">Call</button>
                      <button className="contact-btn" type="button">Text</button>
                      <button className="contact-btn" type="button">Email</button>
                    </div>
                  </div>
                </div>

                <hr className="detail-divider" />

                <div className="detail-row">
                  <div className="detail-field grow">
                    <div className="detail-label">Internal Note</div>
                    <div className="internal-note-box">{currentTicket.internal_note || currentTicket.problem_description || "No internal note available."}</div>
                  </div>
                </div>
              </>
            ) : (
              <div className="text-sm text-slate-300">Select a ticket to view its details.</div>
            )}
          </div>
        </div>
      </div>

      <style>{`
        .map-panel {
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 10px;
          overflow: hidden;
          color: #fff;
          backdrop-filter: blur(10px);
          display: flex;
          flex-direction: column;
        }

        .map-topbar {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 1rem;
          padding: 0.65rem 1rem;
          background: rgba(17, 24, 39, 0.75);
          border-bottom: 1px solid rgba(255, 255, 255, 0.12);
          flex-wrap: wrap;
          position: relative;
        }

        .date-nav {
          display: flex;
          align-items: center;
          gap: 0.55rem;
        }

        .date-nav-btn {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          border: 1px solid rgba(96, 165, 250, 0.5);
          background: transparent;
          color: #60a5fa;
          font-size: 1.05rem;
          font-weight: 700;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background 0.15s;
        }

        .date-nav-btn:hover {
          background: rgba(96, 165, 250, 0.15);
        }

        #mapDate {
          background: rgba(15, 23, 42, 0.85);
          border: 1.5px solid rgba(96, 165, 250, 0.55);
          border-radius: 6px;
          color: #e2e8f0;
          font-size: 0.9rem;
          font-weight: 600;
          cursor: pointer;
          text-align: center;
          padding: 0.32rem 0.65rem;
          min-width: 130px;
          letter-spacing: 0.03em;
          outline: none;
          box-shadow: 0 0 0 0 rgba(96, 165, 250, 0);
          transition: border-color 0.2s, box-shadow 0.2s;
        }

        #mapDate:focus, #mapDate:hover {
          border-color: #60a5fa;
          box-shadow: 0 0 0 3px rgba(96, 165, 250, 0.18);
        }

        .color-legend {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          font-size: 0.85rem;
          position: absolute;
          right: 1rem;
        }

        .color-legend label {
          display: flex;
          align-items: center;
          gap: 0.3rem;
          cursor: pointer;
          color: #cbd5e1;
        }

        .map-body {
          display: flex;
          flex: 1;
          position: relative;
          min-height: 620px;
        }

        .ticket-sidebar {
          width: 230px;
          min-width: 200px;
          background: rgba(15, 23, 42, 0.96);
          border-right: 1px solid rgba(255, 255, 255, 0.1);
          display: flex;
          flex-direction: column;
          z-index: 10;
        }

        .sidebar-tabs {
          display: flex;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }

        .sidebar-tab {
          flex: 1;
          padding: 0.6rem;
          text-align: center;
          font-size: 0.85rem;
          font-weight: 600;
          cursor: pointer;
          border: none;
          background: transparent;
          color: #64748b;
          transition: color 0.15s;
        }

        .sidebar-tab.active {
          color: #fff;
          border-bottom: 2px solid #60a5fa;
        }

        .ticket-list {
          overflow-y: auto;
          flex: 1;
          display: none;
        }

        .ticket-list.visible {
          display: flex;
          flex-direction: column;
        }

        .ticket-card {
          display: flex;
          flex-direction: column;
          padding: 0.55rem 0.75rem;
          border-bottom: 1px solid rgba(255, 255, 255, 0.07);
          cursor: pointer;
          border-left: 4px solid transparent;
          transition: background 0.15s;
          background: transparent;
          text-align: left;
        }

        .ticket-card:hover {
          background: rgba(255, 255, 255, 0.05);
        }

        .ticket-card.selected {
          background: rgba(96, 165, 250, 0.12);
        }

        .ticket-card-top {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 0.4rem;
        }

        .ticket-card-no {
          font-size: 0.8rem;
          font-weight: 700;
          color: #e2e8f0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .tech-badge {
          font-size: 0.7rem;
          font-weight: 700;
          padding: 0.15rem 0.45rem;
          border-radius: 4px;
          white-space: nowrap;
        }

        .ticket-card-addr {
          font-size: 0.74rem;
          color: #94a3b8;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          margin-top: 0.2rem;
        }

        .status-view {
          padding: 0.75rem;
          display: none;
          flex-direction: column;
          gap: 0.5rem;
        }

        .status-view.visible {
          display: flex;
        }

        .status-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 0.82rem;
        }

        .status-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          display: inline-block;
          margin-right: 0.5rem;
        }

        .map-area {
          flex: 1;
          position: relative;
          min-height: 500px;
          background: #d1e8d1;
          background-image:
            linear-gradient(rgba(0,0,0,0.06) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0,0,0,0.06) 1px, transparent 1px);
          background-size: 48px 48px;
          overflow: hidden;
        }

        .map-area.satellite-mode {
          background: #1c2d1c;
          background-image:
            linear-gradient(rgba(0,255,0,0.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0,255,0,0.04) 1px, transparent 1px);
        }

        .topbar-location-group {
          position: absolute;
          left: 1rem;
          top: 50%;
          transform: translateY(-50%);
          display: flex;
          align-items: center;
          gap: 0.4rem;
          z-index: 5;
        }

        .topbar-location-group select {
          background: rgba(15, 23, 42, 0.9);
          border: 1px solid rgba(96, 165, 250, 0.45);
          color: #e2e8f0;
          font-size: 0.78rem;
          font-weight: 600;
          padding: 0.3rem 0.55rem;
          border-radius: 4px;
          cursor: pointer;
          max-width: 180px;
          outline: none;
        }

        .topbar-location-group select:focus {
          border-color: #60a5fa;
        }

        .map-type-toggle {
          position: absolute;
          top: 1rem;
          left: 1rem;
          border: 2px solid #9ca3af;
          border-radius: 4px;
          overflow: hidden;
          z-index: 5;
          display: flex;
        }

        .map-type-btn {
          padding: 0.42rem 0.85rem;
          font-size: 0.82rem;
          font-weight: 600;
          cursor: pointer;
          border: none;
          background: #f3f4f6;
          color: #1f2937;
        }

        .map-type-btn.active {
          background: #fff;
          box-shadow: inset 0 -2px 0 #3b82f6;
        }

        .map-placeholder-inner {
          position: absolute;
          inset: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 0.75rem;
          pointer-events: none;
        }

        .map-placeholder-icon {
          opacity: 0.35;
        }

        .map-pins {
          position: absolute;
          inset: 0;
          pointer-events: none;
        }

        .map-pin {
          position: absolute;
          display: flex;
          flex-direction: column;
          align-items: center;
          cursor: pointer;
          pointer-events: all;
          transform: translate(-50%, -100%);
          transition: transform 0.15s;
          background: transparent;
          border: none;
          padding: 0;
        }

        .map-pin:hover {
          transform: translate(-50%, -105%) scale(1.15);
          z-index: 10;
        }

        .pin-bubble {
          padding: 0.35rem 0.75rem;
          border-radius: 4px;
          font-size: 0.75rem;
          font-weight: 700;
          color: #fff;
          white-space: nowrap;
          box-shadow: 0 2px 8px rgba(0,0,0,0.35);
          display: flex;
          align-items: center;
          gap: 0.3rem;
          flex-direction: column;
        }

        .pin-initials {
          min-width: 1rem;
          line-height: 1;
        }

        .pin-time {
          font-size: 0.65rem;
          opacity: 0.9;
          line-height: 1;
        }

        .pin-tail {
          width: 0;
          height: 0;
          border-left: 5px solid transparent;
          border-right: 5px solid transparent;
          margin-top: -1px;
        }

        .selected-day-panel {
          position: absolute;
          top: 1rem;
          right: 1rem;
          width: 285px;
          background: rgba(10, 15, 30, 0.97);
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 6px;
          z-index: 20;
          overflow: hidden;
        }

        .selected-day-header {
          background: #0f172a;
          padding: 0.55rem 0.9rem;
          font-size: 0.88rem;
          font-weight: 700;
          color: #fff;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }

        .selected-day-filters {
          display: flex;
          gap: 0.6rem;
          padding: 0.55rem 0.85rem;
          flex-wrap: wrap;
        }

        .filter-chip {
          display: flex;
          align-items: center;
          gap: 0.3rem;
          font-size: 0.78rem;
          color: #e2e8f0;
          cursor: pointer;
        }

        .detail-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.55);
          z-index: 200;
          display: none;
          align-items: center;
          justify-content: center;
          padding: 1rem;
        }

        .detail-overlay.open {
          display: flex;
        }

        .detail-modal {
          background: #1e293b;
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 10px;
          width: 700px;
          max-width: 95vw;
          max-height: 92vh;
          overflow-y: auto;
          color: #f1f5f9;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
        }

        .detail-modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0.85rem 1.1rem;
          background: #0f172a;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
          position: sticky;
          top: 0;
          z-index: 1;
        }

        .detail-title-row {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }

        .detail-ticket-no {
          font-size: 1.1rem;
          font-weight: 700;
          color: #fff;
        }

        .detail-ticket-link {
          text-decoration: underline;
          text-underline-offset: 2px;
        }

        .detail-ticket-link:hover {
          color: #93c5fd;
        }

        .google-btn {
          padding: 0.28rem 0.7rem;
          background: #4285f4;
          color: #fff;
          border: none;
          border-radius: 4px;
          font-size: 0.76rem;
          font-weight: 600;
          cursor: pointer;
        }

        .google-btn:hover {
          background: #3b78de;
        }

        .modal-close-btn {
          background: transparent;
          border: none;
          color: #64748b;
          font-size: 1.4rem;
          cursor: pointer;
          line-height: 1;
          padding: 0.1rem 0.3rem;
        }

        .modal-close-btn:hover {
          color: #fff;
        }

        .detail-body {
          padding: 1rem 1.1rem;
        }

        .detail-row {
          display: flex;
          gap: 1.5rem;
          margin-bottom: 0.65rem;
          flex-wrap: wrap;
          align-items: flex-start;
        }

        .detail-field {
          display: flex;
          flex-direction: column;
          gap: 0.22rem;
          min-width: 130px;
        }

        .detail-field.grow {
          flex: 1;
        }

        .detail-label {
          font-size: 0.72rem;
          font-weight: 700;
          color: #64748b;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }

        .detail-value {
          font-size: 0.9rem;
          color: #f1f5f9;
        }

        .detail-divider {
          border: none;
          border-top: 1px solid rgba(255, 255, 255, 0.08);
          margin: 0.8rem 0;
        }

        .schedule-box {
          display: inline-flex;
          align-items: center;
          gap: 0.55rem;
          background: rgba(30, 64, 175, 0.2);
          border: 1px solid rgba(96, 165, 250, 0.3);
          border-radius: 6px;
          padding: 0.45rem 0.85rem;
          font-size: 0.88rem;
          flex-wrap: wrap;
        }

        .contact-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 0.45rem;
          margin-top: 0.45rem;
        }

        .contact-btn {
          padding: 0.28rem 0.7rem;
          border-radius: 4px;
          border: 1px solid rgba(255, 255, 255, 0.18);
          background: rgba(30, 41, 59, 0.9);
          color: #e2e8f0;
          font-size: 0.76rem;
          cursor: pointer;
          transition: background 0.15s;
        }

        .contact-btn:hover {
          background: rgba(30, 64, 175, 0.3);
          border-color: rgba(96, 165, 250, 0.4);
        }

        .status-pill-detail {
          display: inline-block;
          padding: 0.25rem 0.7rem;
          border-radius: 99px;
          font-size: 0.8rem;
          font-weight: 600;
        }

        .internal-note-box {
          font-size: 0.82rem;
          color: #cbd5e1;
          background: rgba(15, 23, 42, 0.6);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 6px;
          padding: 0.65rem 0.9rem;
          line-height: 1.65;
          white-space: pre-wrap;
          width: 100%;
          box-sizing: border-box;
        }

        @media (max-width: 768px) {
          .ticket-sidebar {
            width: 175px;
            min-width: 150px;
          }

          .color-legend {
            position: static;
            right: auto;
          }

          .selected-day-panel {
            width: 220px;
          }

          .map-body {
            min-height: 480px;
          }
        }
      `}</style>
    </div>
  );
}
