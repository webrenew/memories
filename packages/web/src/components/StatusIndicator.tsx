"use client";

import React, { useState, useEffect, useCallback } from "react";

type Status = "healthy" | "unhealthy" | "checking";

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export function StatusIndicator(): React.JSX.Element {
  const [status, setStatus] = useState<Status>("checking");
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const checkHealth = useCallback(async () => {
    try {
      const response = await fetch("/api/health", {
        method: "GET",
        cache: "no-store",
      });

      if (response.ok) {
        setStatus("healthy");
      } else {
        setStatus("unhealthy");
      }
    } catch (error) {
      console.error("Health check failed:", error);
      setStatus("unhealthy");
    } finally {
      setLastChecked(new Date());
    }
  }, []);

  useEffect(() => {
    // Initial check
    checkHealth();

    // Set up polling interval
    const interval = setInterval(checkHealth, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [checkHealth]);

  const statusConfig = {
    healthy: {
      color: "bg-emerald-500",
      label: "Stable",
    },
    unhealthy: {
      color: "bg-red-500",
      label: "Degraded",
    },
    checking: {
      color: "bg-yellow-500",
      label: "Checking",
    },
  };

  const config = statusConfig[status];

  return (
    <div
      className="flex items-center gap-2"
      title={lastChecked ? `Last checked: ${lastChecked.toLocaleTimeString()}` : "Checking..."}
    >
      <div className={`w-1.5 h-1.5 rounded-full ${config.color} animate-pulse`} />
      <span className="text-[10px] text-muted-foreground font-mono tracking-wide uppercase">
        {config.label}
      </span>
    </div>
  );
}
