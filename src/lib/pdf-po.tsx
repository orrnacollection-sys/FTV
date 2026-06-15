import { Document, Page, Text, View, StyleSheet, renderToBuffer, Image } from "@react-pdf/renderer";
import React from "react";
import { toDisplayDate } from "@/lib/date";

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 9, fontFamily: "Helvetica" },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 18, borderBottom: 1, borderColor: "#0A0A0A", paddingBottom: 12 },
  orgBlock: { flexDirection: "column" },
  orgName: { fontSize: 16, fontFamily: "Helvetica-Bold" },
  orgLine: { color: "#3D3D3D", marginTop: 2 },
  title: { fontSize: 22, fontFamily: "Helvetica-Bold", letterSpacing: 1, textAlign: "right" },
  meta: { textAlign: "right", marginTop: 4, color: "#3D3D3D" },

  twoCol: { flexDirection: "row", justifyContent: "space-between", marginBottom: 18 },
  block: { width: "48%" },
  blockLabel: { fontSize: 8, color: "#888", letterSpacing: 1, marginBottom: 4, textTransform: "uppercase" },
  blockName: { fontSize: 11, fontFamily: "Helvetica-Bold" },
  blockLine: { color: "#3D3D3D", marginTop: 2 },

  table: { borderWidth: 1, borderColor: "#E0E0E0", borderRadius: 4, overflow: "hidden" },
  trHead: { flexDirection: "row", backgroundColor: "#FFF8E1", borderBottom: 1, borderColor: "#E0E0E0", padding: 6 },
  tr: { flexDirection: "row", borderBottom: 1, borderColor: "#EEEEEE", padding: 6, minHeight: 26 },
  trLast: { flexDirection: "row", padding: 6 },
  th: { fontFamily: "Helvetica-Bold", fontSize: 8, textTransform: "uppercase", color: "#3D3D3D", letterSpacing: 0.5 },
  td: { fontSize: 9 },

  c_image: { width: 34 },
  c_sku: { width: 72 },
  c_name: { flex: 1 },
  c_hsn: { width: 48 },
  c_model: { width: 56 },
  c_qty: { width: 38, textAlign: "right" },
  c_rate: { width: 46, textAlign: "right" },
  c_tax: { width: 36, textAlign: "right" },
  c_total: { width: 56, textAlign: "right" },

  thumb: { width: 30, height: 30, borderRadius: 2 },

  totals: { marginTop: 12, alignSelf: "flex-end", width: 200 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 2 },
  grandRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 6, paddingTop: 6, borderTop: 1, borderColor: "#0A0A0A", fontFamily: "Helvetica-Bold" },

  footer: { position: "absolute", bottom: 24, left: 36, right: 36, fontSize: 8, color: "#888", textAlign: "center" },
  notes: { marginTop: 20, fontSize: 9 },
  notesLabel: { fontSize: 8, color: "#888", textTransform: "uppercase", letterSpacing: 1 },
});

export type POPdfData = {
  poNumber: string;
  poDate: Date | string;
  dueDate: Date | string | null;
  notes: string | null;
  /** Company header — fetched by the caller via `getActiveCompany()`. */
  org: {
    name: string;            // brandName
    legalName: string;
    addressLine: string;     // pre-formatted "address, city, state, pincode"
    gst: string | null;      // default GSTIN (or null if none configured)
  };
  vendor: {
    code: string;
    name: string;
    address: string | null;
    city: string | null;
    state: string | null;
    pincode: string | null;
    gst: string | null;
  };
  items: {
    skuCode: string;
    name: string;
    hsn: string | null;
    model: string;
    qty: number;
    rate: number;
    taxRate: number;
    total: number;
    /** Optional absolute URL to image. */
    imageUrl: string | null;
  }[];
  subtotal: number;
  taxTotal: number;
  grandTotal: number;
};

function POPdf({ data }: { data: POPdfData }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.orgBlock}>
            <Text style={styles.orgName}>{data.org.name}</Text>
            {data.org.addressLine && <Text style={styles.orgLine}>{data.org.addressLine}</Text>}
            {data.org.gst && <Text style={styles.orgLine}>GSTIN: {data.org.gst}</Text>}
          </View>
          <View>
            <Text style={styles.title}>PURCHASE ORDER</Text>
            <Text style={styles.meta}>{data.poNumber}</Text>
            <Text style={styles.meta}>Date: {toDisplayDate(data.poDate)}</Text>
            {data.dueDate && <Text style={styles.meta}>Due: {toDisplayDate(data.dueDate)}</Text>}
          </View>
        </View>

        <View style={styles.twoCol}>
          <View style={styles.block}>
            <Text style={styles.blockLabel}>Vendor</Text>
            <Text style={styles.blockName}>{data.vendor.name}</Text>
            <Text style={styles.blockLine}>Code: {data.vendor.code}</Text>
            {data.vendor.gst && <Text style={styles.blockLine}>GST: {data.vendor.gst}</Text>}
            {data.vendor.address && <Text style={styles.blockLine}>{data.vendor.address}</Text>}
            {(data.vendor.city || data.vendor.state || data.vendor.pincode) && (
              <Text style={styles.blockLine}>
                {[data.vendor.city, data.vendor.state, data.vendor.pincode].filter(Boolean).join(", ")}
              </Text>
            )}
          </View>
          <View style={styles.block}>
            <Text style={styles.blockLabel}>Ship to</Text>
            <Text style={styles.blockName}>{data.org.name}</Text>
            {data.org.addressLine && <Text style={styles.blockLine}>{data.org.addressLine}</Text>}
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.trHead}>
            <Text style={[styles.th, styles.c_image]}>Img</Text>
            <Text style={[styles.th, styles.c_sku]}>SKU Code</Text>
            <Text style={[styles.th, styles.c_name]}>Description</Text>
            <Text style={[styles.th, styles.c_hsn]}>HSN</Text>
            <Text style={[styles.th, styles.c_model]}>Model</Text>
            <Text style={[styles.th, styles.c_qty]}>Qty</Text>
            <Text style={[styles.th, styles.c_rate]}>Rate</Text>
            <Text style={[styles.th, styles.c_tax]}>GST %</Text>
            <Text style={[styles.th, styles.c_total]}>Total</Text>
          </View>
          {data.items.map((it, idx) => (
            <View key={idx} style={idx === data.items.length - 1 ? styles.trLast : styles.tr}>
              <View style={styles.c_image}>
                {/* react-pdf Image is not a DOM <img>; alt is not applicable. */}
                {/* eslint-disable-next-line jsx-a11y/alt-text */}
                {it.imageUrl ? <Image src={it.imageUrl} style={styles.thumb} /> : <Text> </Text>}
              </View>
              <Text style={[styles.td, styles.c_sku]}>{it.skuCode}</Text>
              <Text style={[styles.td, styles.c_name]}>{it.name}</Text>
              <Text style={[styles.td, styles.c_hsn]}>{it.hsn ?? "—"}</Text>
              <Text style={[styles.td, styles.c_model]}>{it.model.replace("_", "-")}</Text>
              <Text style={[styles.td, styles.c_qty]}>{it.qty.toFixed(2)}</Text>
              <Text style={[styles.td, styles.c_rate]}>{it.rate.toFixed(2)}</Text>
              <Text style={[styles.td, styles.c_tax]}>{it.taxRate.toFixed(2)}</Text>
              <Text style={[styles.td, styles.c_total]}>{it.total.toFixed(2)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.totals}>
          <View style={styles.totalRow}>
            <Text>Subtotal</Text>
            <Text>{data.subtotal.toFixed(2)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text>GST</Text>
            <Text>{data.taxTotal.toFixed(2)}</Text>
          </View>
          <View style={styles.grandRow}>
            <Text>Grand Total</Text>
            <Text>{data.grandTotal.toFixed(2)}</Text>
          </View>
        </View>

        {data.notes && (
          <View style={styles.notes}>
            <Text style={styles.notesLabel}>Notes</Text>
            <Text>{data.notes}</Text>
          </View>
        )}

        <Text style={styles.footer} fixed>
          {[data.org.name, data.org.addressLine, data.org.gst ? `GSTIN ${data.org.gst}` : null]
            .filter(Boolean)
            .join(" · ")}
        </Text>
      </Page>
    </Document>
  );
}

export async function renderPoPdf(data: POPdfData): Promise<Buffer> {
  return await renderToBuffer(<POPdf data={data} />);
}
