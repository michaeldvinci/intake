"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { WeightUnitProvider } from "../context/WeightUnit";
import { NutritionGoalsProvider } from "../context/NutritionGoals";
import { useAuth } from "../context/Auth";

const SIDEBAR_STORAGE_KEY = "intake_sidebar_collapsed";

function SidebarInner() {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  const { user, logout } = useAuth();

  // Don't render nav shell on login page
  if (pathname === "/login") return null;

  useEffect(() => {
    const saved = localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (saved === "true") {
      setCollapsed(true);
    }
  }, []);

  function toggleSidebar() {
    const newState = !collapsed;
    setCollapsed(newState);
    localStorage.setItem(SIDEBAR_STORAGE_KEY, String(newState));
  }

  return (
    <>
      <aside className={`sidebar ${collapsed ? "sidebar-collapsed" : ""}`}>
        <a href="/" className="sidebar-logo" style={{ textDecoration: "none" }}>
          <i className="fa-solid fa-utensils sidebar-logo-icon" aria-hidden="true" />
          {!collapsed && <div className="sidebar-logo-wordmark">In<span>Take</span></div>}
        </a>
        <a href="/" className="nav-link" title="Ledger">
          <i className="fa-solid fa-book-open nav-icon" />
          {!collapsed && <span>Ledger</span>}
        </a>
        <a href="/calendar" className="nav-link" title="Calendar">
          <i className="fa-solid fa-calendar-days nav-icon" />
          {!collapsed && <span>Calendar</span>}
        </a>
        <a href="/log" className="nav-link" title="Log">
          <i className="fa-solid fa-pencil nav-icon" />
          {!collapsed && <span>Log</span>}
        </a>
        <a href="/recipes" className="nav-link" title="Recipes">
          <i className="fa-solid fa-bowl-food nav-icon" />
          {!collapsed && <span>Recipes</span>}
        </a>
        <a href="/shopping" className="nav-link" title="Shopping">
          <i className="fa-solid fa-cart-shopping nav-icon" />
          {!collapsed && <span>Shopping</span>}
        </a>
        <a href="/pantry" className="nav-link" title="Pantry">
          <i className="fa-solid fa-box-open nav-icon" />
          {!collapsed && <span>Pantry</span>}
        </a>
        <a href="/workouts" className="nav-link" title="Workouts">
          <i className="fa-solid fa-dumbbell nav-icon" />
          {!collapsed && <span>Workouts</span>}
        </a>
        <a href="/nudge" className="nav-link" title="Nudge">
          <i className="fa-solid fa-bell nav-icon" />
          {!collapsed && <span>Nudge</span>}
        </a>
        <a href="/metrics" className="nav-link" title="Metrics">
          <i className="fa-solid fa-chart-line nav-icon" />
          {!collapsed && <span>Metrics</span>}
        </a>

        <div style={{ flex: 1 }} />

        <button
          onClick={toggleSidebar}
          className="nav-link"
          style={{
            width: "100%",
            background: "none",
            border: "none",
            cursor: "pointer",
          }}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <i className={`fa-solid ${collapsed ? "fa-angle-right" : "fa-angle-left"} nav-icon`} />
          {!collapsed && <span>Collapse</span>}
        </button>

        <div className="nav-link" style={{ overflow: "hidden" }}>
          <div style={{
            width: 18, height: 18, borderRadius: "50%",
            background: "var(--accent)", color: "#fff",
            fontSize: 10, fontWeight: 700,
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
          }}>
            {user ? (user.display_name || user.email).charAt(0).toUpperCase() : ""}
          </div>
          {!collapsed && (
            <span style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {user ? (user.display_name || user.email) : ""}
            </span>
          )}
        </div>
        <button
          onClick={logout}
          className="nav-link"
          style={{ width: "100%", background: "none", border: "none", cursor: "pointer" }}
          title="Sign out"
        >
          <i className="fa-solid fa-arrow-right-from-bracket nav-icon" />
          {!collapsed && <span>Sign out</span>}
        </button>
        <a href="/settings" className="nav-link" style={{ width: "100%" }} title="Settings">
          <i className="fa-solid fa-gear nav-icon" />
          {!collapsed && <span>Settings</span>}
        </a>
      </aside>

      {/* Bottom nav for mobile */}
      <nav className="bottom-nav">
        <a href="/" className={`bottom-nav-item${pathname === "/" ? " active" : ""}`}>
          <i className="fa-solid fa-book-open" />
          <span>Ledger</span>
        </a>
        <a href="/recipes" className={`bottom-nav-item${pathname?.startsWith("/recipes") ? " active" : ""}`}>
          <i className="fa-solid fa-bowl-food" />
          <span>Recipes</span>
        </a>
        <a href="/workouts" className={`bottom-nav-item${pathname === "/workouts" ? " active" : ""}`}>
          <i className="fa-solid fa-dumbbell" />
          <span>Workouts</span>
        </a>
        <a href="/calendar" className={`bottom-nav-item${pathname === "/calendar" ? " active" : ""}`}>
          <i className="fa-solid fa-calendar-days" />
          <span>Calendar</span>
        </a>
        <a href="/settings" className={`bottom-nav-item${pathname === "/settings" ? " active" : ""}`}>
          <i className="fa-solid fa-gear" />
          <span>Settings</span>
        </a>
      </nav>
    </>
  );
}

export function Sidebar({ children }: { children: React.ReactNode }) {
  return (
    <WeightUnitProvider>
      <NutritionGoalsProvider>
        <SidebarShell>{children}</SidebarShell>
      </NutritionGoalsProvider>
    </WeightUnitProvider>
  );
}

function SidebarShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/login") {
    return <>{children}</>;
  }
  return (
    <div className="shell">
      <SidebarInner />
      {children}
    </div>
  );
}
