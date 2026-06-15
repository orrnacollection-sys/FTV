"use client";
import { Toaster, toast as hotToast } from "react-hot-toast";

export function ToastProvider() {
  return (
    <Toaster
      position="bottom-right"
      gutter={8}
      toastOptions={{
        duration: 3500,
        style: {
          background: "#0A0A0A",
          color: "#FFFFFF",
          borderRadius: "10px",
          padding: "10px 14px",
          fontSize: "13px",
          fontFamily: "'Plus Jakarta Sans', sans-serif",
          fontWeight: 500,
          border: "1.5px solid #2C2C2C",
        },
        success: {
          iconTheme: { primary: "#FFC107", secondary: "#0A0A0A" },
        },
        error: {
          iconTheme: { primary: "#DC2626", secondary: "#FFFFFF" },
          style: { background: "#7F1D1D", color: "#FEF2F2", border: "1.5px solid #B91C1C" },
        },
      }}
    />
  );
}

export const toast = hotToast;
