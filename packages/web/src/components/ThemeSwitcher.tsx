"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";

export function ThemeSwitcher(): React.JSX.Element {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Button widths: active buttons show label and are wider
  const activeWidth = {
    dark: 62,
    light: 62,
    system: 82,
  };
  const inactiveWidth = 24;

  // Calculate indicator position and width based on active theme
  const getIndicatorConfig = () => {
    switch (theme) {
      case "dark":
        return { x: 0, width: activeWidth.dark };
      case "light":
        return { x: inactiveWidth, width: activeWidth.light };
      case "system":
      default:
        return { x: inactiveWidth * 2, width: activeWidth.system };
    }
  };

  // Calculate button widths based on active state
  const getDarkWidth = () => (theme === "dark" ? activeWidth.dark : inactiveWidth);
  const getLightWidth = () => (theme === "light" ? activeWidth.light : inactiveWidth);
  const getSystemWidth = () => (theme === "system" ? activeWidth.system : inactiveWidth);

  if (!mounted) {
    return (
      <div className="border-border bg-muted relative flex rounded-lg border p-1 min-w-max h-8 opacity-50" />
    );
  }

  const indicatorConfig = getIndicatorConfig();

  return (
    <div className="border-border bg-muted relative flex rounded-lg border p-1 min-w-max" role="radiogroup" aria-label="Theme selection">
      <motion.div
        className="theme-selector-indicator bg-background absolute top-1 left-1 rounded-sm ease-out h-6 shadow-sm"
        initial={false}
        animate={{
          x: indicatorConfig.x,
          width: indicatorConfig.width,
        }}
        transition={{
          type: "spring",
          stiffness: 400,
          damping: 30,
        }}
      />
      
      {/* Dark Button */}
      <motion.button
        type="button"
        onClick={() => setTheme("dark")}
        className={`theme-selector-button relative z-10 flex cursor-pointer items-center justify-center rounded-sm h-6 gap-1 px-2 transition-colors duration-200 ${
          theme === "dark" ? "text-foreground" : "text-muted-foreground hover:text-foreground"
        }`}
        title="Dark"
        aria-label="Switch to Dark theme"
        role="radio"
        aria-checked={theme === "dark"}
        animate={{ width: getDarkWidth() }}
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
      >
        <span className="flex-shrink-0">
          <svg width="15" height="14" viewBox="0 0 15 14" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M13.2693 7.77894C13.2131 7.72271 13.1428 7.68281 13.0657 7.66354C12.9886 7.64427 12.9077 7.64636 12.8318 7.66957C11.9975 7.92176 11.1105 7.94291 10.2652 7.73075C9.41995 7.51859 8.64806 7.08108 8.03181 6.46483C7.41556 5.84858 6.97805 5.07669 6.76589 4.2314C6.55373 3.38611 6.57487 2.4991 6.82707 1.66488C6.85048 1.58887 6.85272 1.50791 6.83355 1.43072C6.81439 1.35352 6.77454 1.28301 6.7183 1.22677C6.66206 1.17053 6.59155 1.13069 6.51436 1.11152C6.43717 1.09236 6.35621 1.0946 6.2802 1.11801C5.12685 1.47131 4.11432 2.17938 3.38668 3.14144C2.75034 3.98629 2.36219 4.99183 2.26584 6.04512C2.16949 7.0984 2.36875 8.15768 2.84123 9.10396C3.31372 10.0502 4.04071 10.846 4.94053 11.4019C5.84036 11.9578 6.87736 12.2517 7.93504 12.2507C9.16898 12.2545 10.3701 11.8534 11.3541 11.1089C12.3162 10.3812 13.0242 9.36869 13.3775 8.21535C13.4007 8.13962 13.4028 8.05903 13.3838 7.98217C13.3647 7.90531 13.3251 7.83508 13.2693 7.77894ZM10.828 10.41C9.90135 11.1079 8.75376 11.4476 7.5965 11.3666C6.43923 11.2856 5.35018 10.7892 4.52983 9.96896C3.70949 9.14867 3.21306 8.05967 3.13193 6.90241C3.0508 5.74515 3.39044 4.59753 4.08832 3.67082C4.54299 3.07038 5.13081 2.58366 5.80551 2.24894C5.76707 2.51868 5.7477 2.79078 5.74754 3.06324C5.74913 4.57117 6.34886 6.01688 7.41513 7.08315C8.4814 8.14942 9.92711 8.74915 11.435 8.75074C11.708 8.75065 11.9807 8.73128 12.251 8.69277C11.916 9.36759 11.4288 9.95541 10.828 10.41Z"
              fill="currentColor"
            />
          </svg>
        </span>
        {theme === "dark" && (
          <motion.p
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: "auto" }}
            exit={{ opacity: 0, width: 0 }}
            className="font-mono text-[12px] leading-[100%] tracking-[-0.015rem] uppercase whitespace-nowrap"
          >
            Dark
          </motion.p>
        )}
      </motion.button>

      {/* Light Button */}
      <motion.button
        type="button"
        onClick={() => setTheme("light")}
        className={`theme-selector-button relative z-10 flex cursor-pointer items-center justify-center rounded-sm h-6 gap-1 px-2 transition-colors duration-200 ${
          theme === "light" ? "text-foreground" : "text-muted-foreground hover:text-foreground"
        }`}
        title="Light"
        aria-label="Switch to Light theme"
        role="radio"
        aria-checked={theme === "light"}
        animate={{ width: getLightWidth() }}
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
      >
        <span className="flex-shrink-0">
          <svg width="15" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0"/><path d="M12 5l0 -2"/><path d="M17 7l1.4 -1.4"/><path d="M19 12l2 0"/><path d="M17 17l1.4 1.4"/><path d="M12 19l0 2"/><path d="M7 17l-1.4 1.4"/><path d="M6 12l-2 0"/><path d="M7 7l-1.4 -1.4"/>
          </svg>
        </span>
        {theme === "light" && (
          <motion.p
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: "auto" }}
            exit={{ opacity: 0, width: 0 }}
            className="font-mono text-[12px] leading-[100%] tracking-[-0.015rem] uppercase whitespace-nowrap"
          >
            Light
          </motion.p>
        )}
      </motion.button>

      {/* System Button */}
      <motion.button
        type="button"
        onClick={() => setTheme("system")}
        className={`theme-selector-button relative z-10 flex cursor-pointer items-center justify-center rounded-sm h-6 gap-1 px-2 transition-colors duration-200 ${
          theme === "system" ? "text-foreground" : "text-muted-foreground hover:text-foreground"
        }`}
        title="System"
        aria-label="Switch to System theme"
        role="radio"
        aria-checked={theme === "system"}
        animate={{ width: getSystemWidth() }}
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
      >
        <span className="flex-shrink-0">
          <svg width="15" height="14" viewBox="0 0 15 14" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M11.875 2.1875H3.125C2.7769 2.1875 2.44306 2.32578 2.19692 2.57192C1.95078 2.81806 1.8125 3.1519 1.8125 3.5V9.625C1.8125 9.9731 1.95078 10.3069 2.19692 10.5531C2.44306 10.7992 2.7769 10.9375 3.125 10.9375H7.0625V11.8125H5.75C5.63397 11.8125 5.52269 11.8586 5.44064 11.9406C5.35859 12.0227 5.3125 12.134 5.3125 12.25C5.3125 12.366 5.35859 12.4773 5.44064 12.5594C5.52269 12.6414 5.63397 12.6875 5.75 12.6875H9.25C9.36603 12.6875 9.47731 12.6414 9.55936 12.5594C9.64141 12.4773 9.6875 12.366 9.6875 12.25C9.6875 12.134 9.64141 12.0227 9.55936 11.9406C9.47731 11.8586 9.36603 11.8125 9.25 11.8125H7.9375V10.9375H11.875C12.2231 10.9375 12.5569 10.7992 12.8031 10.5531C13.0492 10.3069 13.1875 9.9731 13.1875 9.625V3.5C13.1875 3.1519 13.0492 2.81806 12.8031 2.57192C12.5569 2.32578 12.2231 2.1875 11.875 2.1875ZM3.125 3.0625H11.875C11.991 3.0625 12.1023 3.10859 12.1844 3.19064C12.2664 3.27269 12.3125 3.38397 12.3125 3.5V7.875H2.6875V3.5C2.6875 3.38397 2.73359 3.27269 2.81564 3.19064C2.89769 3.10859 3.00897 3.0625 3.125 3.0625ZM11.875 10.0625H3.125C3.00897 10.0625 2.89769 10.0164 2.81564 9.93436C2.73359 9.85231 2.6875 9.74103 2.6875 9.625V8.75H12.3125V9.625C12.3125 9.74103 12.2664 9.85231 12.1844 9.93436C12.1023 10.0164 11.991 10.0625 11.875 10.0625Z"
              fill="currentColor"
            />
          </svg>
        </span>
        {theme === "system" && (
          <motion.p
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: "auto" }}
            exit={{ opacity: 0, width: 0 }}
            className="font-mono text-[12px] leading-[100%] tracking-[-0.015rem] uppercase whitespace-nowrap"
          >
            System
          </motion.p>
        )}
      </motion.button>
    </div>
  );
}
