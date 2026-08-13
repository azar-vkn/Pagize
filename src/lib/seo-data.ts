export type SEOData = {
  seoTitle: string;
  seoDescription: string;
  seoIntro: string;
  howTo: { title: string; step: string }[];
  faqs: { q: string; a: string }[];
  relatedTools: string[];
};

export const toolSEOData: Record<string, SEOData> = {
  "merge-pdf": {
    seoTitle: "Merge PDF Online Free — Pagize",
    seoDescription: "Combine multiple PDF files into one document with Pagize's simple browser-based PDF merger. Your files are processed locally for maximum privacy.",
    seoIntro: "Merging multiple PDF documents shouldn't require uploading your sensitive files to a remote server. Our Merge PDF tool allows you to combine multiple PDFs into a single file directly in your browser. Whether you're assembling a report, combining invoices, or organizing your personal documents, you can drag and drop your files, reorder them as needed, and merge them instantly.",
    howTo: [
      { title: "Select files", step: "Drag and drop your PDF files into the tool or click to select them from your device." },
      { title: "Reorder", step: "Drag the files to arrange them in the exact order you want them to appear in the merged document." },
      { title: "Merge", step: "Click the Merge button. The files will be combined instantly in your browser." },
      { title: "Download", step: "Save the newly merged PDF document to your device." }
    ],
    faqs: [
      { q: "Are my files uploaded to a server?", a: "No. Pagize processes your PDFs directly in your web browser. Your files never leave your device, ensuring complete privacy." },
      { q: "Is there a limit to how many files I can merge?", a: "Because processing happens on your device, the limit depends on your browser's memory, but merging dozens of files works perfectly for most users." },
      { q: "Does merging reduce the quality of my PDFs?", a: "No, merging PDFs does not affect the quality or resolution of the original documents. The pages are simply combined into a new file." }
    ],
    relatedTools: ["split-pdf", "organize-pages", "compress-pdf"]
  },
  "compress-pdf": {
    seoTitle: "Compress PDF Online Free — Pagize",
    seoDescription: "Compress PDF files quickly with Pagize. Use a simple browser-based PDF compressor designed for fast, privacy-conscious document processing.",
    seoIntro: "Large PDF files can be difficult to email, upload, or share. Our Compress PDF tool reduces the file size of your documents while maintaining their quality. By optimizing images and removing unnecessary data, you can significantly shrink your PDFs. Best of all, this compression happens directly on your device, meaning your sensitive documents are never uploaded to our servers.",
    howTo: [
      { title: "Upload PDF", step: "Select the PDF file you want to compress." },
      { title: "Select Compression Level", step: "Choose between Low, Recommended, or Extreme compression depending on your needs." },
      { title: "Compress", step: "Click Compress to shrink your file." },
      { title: "Download", step: "Save the smaller, optimized PDF to your device." }
    ],
    faqs: [
      { q: "Will compression ruin my images?", a: "Our recommended compression level balances size reduction with visual quality, making it ideal for standard documents. Extreme compression may reduce image quality noticeably." },
      { q: "Is the compression done securely?", a: "Yes. All processing is done locally in your browser. Your file is never uploaded or stored on any external server." },
      { q: "Why is my PDF not compressing much?", a: "If your PDF is already optimized or contains mostly text, there may not be much data to compress. Compression works best on PDFs with large, unoptimized images." }
    ],
    relatedTools: ["merge-pdf", "split-pdf", "pdf-to-jpg"]
  },
  "split-pdf": {
    seoTitle: "Split PDF Online Free — Pagize",
    seoDescription: "Split PDF files into individual pages or extract specific page ranges with Pagize's private, browser-based PDF splitter.",
    seoIntro: "Sometimes you only need a few pages from a massive PDF document. Our Split PDF tool allows you to easily separate a single PDF into multiple files, or extract specific page ranges. Whether you want to split a document in half or pull out a single important page, you can do it instantly. Everything happens securely in your browser.",
    howTo: [
      { title: "Choose file", step: "Select the PDF you want to split." },
      { title: "Select mode", step: "Choose to split by specific page ranges (e.g., 1-5, 8, 11-13) or extract every page into separate files." },
      { title: "Split", step: "Click the Split button to process the document." },
      { title: "Save files", step: "Download your new, separated PDF documents." }
    ],
    faqs: [
      { q: "Can I extract just one page?", a: "Yes, simply enter the specific page number in the range input (e.g., '5') to extract just that page." },
      { q: "Is it safe to split confidential documents?", a: "Absolutely. Pagize runs the splitting process locally on your device. We do not upload, view, or store your documents." }
    ],
    relatedTools: ["remove-pages", "extract-pages", "organize-pages"]
  },
  "crop-pdf": {
    seoTitle: "Crop PDF Pages Online — Pagize",
    seoDescription: "Crop PDF margins and adjust page sizes locally in your browser. Set custom margins per page with our private PDF cropping tool.",
    seoIntro: "Need to remove empty white space, crop out a watermark, or adjust the margins of a document? Our Crop PDF tool lets you visually select the area you want to keep. You can apply a uniform crop to all pages, or adjust the crop margins for each page individually. The entire process runs securely on your own device.",
    howTo: [
      { title: "Upload document", step: "Select the PDF you want to crop." },
      { title: "Adjust crop box", step: "Use the visual editor to drag the crop margins, or enter specific point values for the top, bottom, left, and right margins." },
      { title: "Apply to pages", step: "Crop just the current page, or click 'Apply to all' to crop the entire document." },
      { title: "Download", step: "Save the newly cropped PDF." }
    ],
    faqs: [
      { q: "Can I crop each page differently?", a: "Yes! Our tool supports per-page cropping. You can set different margins for every single page in your document." },
      { q: "Does cropping reduce file size?", a: "Cropping modifies the visible area (CropBox) of the PDF. It doesn't necessarily delete the hidden data, so file size may remain similar." },
      { q: "Is this tool completely private?", a: "Yes, all cropping is performed directly in your browser using local resources." }
    ],
    relatedTools: ["organize-pages", "rotate-pdf", "edit-pdf"]
  }
};

export function getSeoData(slug: string): SEOData {
  return toolSEOData[slug] || {
    seoTitle: `${slug.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ')} Online Free — Pagize`,
    seoDescription: `Use our ${slug.split('-').join(' ')} tool to process your documents securely in your browser.`,
    seoIntro: `Welcome to the ${slug.split('-').join(' ')} tool. This utility allows you to process your PDF files locally on your device without uploading them to external servers, ensuring maximum privacy and speed.`,
    howTo: [
      { title: "Select file", step: "Choose the document you want to process." },
      { title: "Configure", step: "Set your desired options." },
      { title: "Process", step: "Click the primary button to execute the task." },
      { title: "Download", step: "Save the resulting file." }
    ],
    faqs: [
      { q: "Is this tool free?", a: "Core functionality is completely free to use." },
      { q: "Are my files private?", a: "Yes, all processing is done locally in your browser. We never upload your files to a server." }
    ],
    relatedTools: ["merge-pdf", "compress-pdf", "split-pdf"]
  };
}
