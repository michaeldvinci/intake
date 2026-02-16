"use client";

import { WeightUnitProvider } from "../context/WeightUnit";

function SidebarInner() {
  return (
    <aside className="sidebar">
      <a href="/" className="sidebar-logo" style={{ textDecoration: "none" }}>
        <i className="fa-solid fa-utensils sidebar-logo-icon" aria-hidden="true" />
        <div className="sidebar-logo-wordmark">In<span>Take</span></div>
      </a>
      <a href="/" className="nav-link">
        <i className="fa-solid fa-book-open nav-icon" />
        Ledger
      </a>
      <a href="/calendar" className="nav-link">
        <i className="fa-solid fa-calendar-days nav-icon" />
        Calendar
      </a>
      <a href="/log" className="nav-link">
        <i className="fa-solid fa-pencil nav-icon" />
        Log
      </a>
      <a href="/recipes" className="nav-link">
        <i className="fa-solid fa-bowl-food nav-icon" />
        Recipes
      </a>
      <a href="/shopping" className="nav-link">
        <i className="fa-solid fa-cart-shopping nav-icon" />
        Shopping
      </a>
      <a href="/pantry" className="nav-link">
        <i className="fa-solid fa-box-open nav-icon" />
        Pantry
      </a>
      <a href="/metrics" className="nav-link">
        <i className="fa-solid fa-chart-line nav-icon" />
        Metrics
      </a>

      <div style={{ flex: 1 }} />

      <a href="/settings" className="nav-link" style={{ width: "100%" }}>
        <i className="fa-solid fa-gear nav-icon" />
        Settings
      </a>
    </aside>
  );
}

export function Sidebar({ children }: { children: React.ReactNode }) {
  return (
    <WeightUnitProvider>
      <SidebarInner />
      {children}
    </WeightUnitProvider>
  );
}
