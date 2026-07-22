import { NextResponse } from "next/server";
import os from "os";

export async function GET() {
  try {
    const interfaces = os.networkInterfaces();
    let macAddress: string | null = null;

    for (const interfaceName of Object.keys(interfaces)) {
      const networkInterface = interfaces[interfaceName];
      if (!networkInterface) continue;

      for (const iface of networkInterface) {
        // Skip internal (loopback) and zero/empty MAC addresses
        if (!iface.internal && iface.mac && iface.mac !== "00:00:00:00:00:00") {
          macAddress = iface.mac.toUpperCase();
          break;
        }
      }
      if (macAddress) break;
    }

    if (macAddress) {
      return NextResponse.json({ success: true, mac: macAddress });
    }

    return NextResponse.json({ success: false, mac: "MAC-NOT-FOUND" }, { status: 404 });
  } catch (err: any) {
    console.error("Error fetching MAC address in Next.js API:", err);
    return NextResponse.json({ success: false, mac: "ERROR-FETCHING-MAC", error: err.message }, { status: 500 });
  }
}
