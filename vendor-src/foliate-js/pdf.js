const pdfjsPath = path => new URL(`vendor/pdfjs/${path}`, import.meta.url).toString()

import './vendor/pdfjs/pdf.mjs'
const pdfjsLib = globalThis.pdfjsLib
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsPath('pdf.worker.mjs')

const fetchText = async url => await (await fetch(url)).text()

// https://raw.githubusercontent.com/mozilla/pdf.js/refs/tags/v5.5.207/web/text_layer_builder.css
const textLayerBuilderCSS = await fetchText(pdfjsPath('text_layer_builder.css'))

// https://raw.githubusercontent.com/mozilla/pdf.js/refs/tags/v5.5.207/web/annotation_layer_builder.css
const annotationLayerBuilderCSS = await fetchText(pdfjsPath('annotation_layer_builder.css'))

// Cozy Shelves: device-pixel rectangles of the raster images painted on a page, from the operator list of the
// render task (the transform is followed through save/restore, forms, groups and annotations). The reader's
// night pages put these pictures back in their own colours on top of the inverted page.
const imageRects = (task, viewport) => {
    const list = task?._internalRenderTask?.operatorList
    if (!list?.fnArray) return []
    const OPS = pdfjsLib.OPS
    const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
        m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
        m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]]
    const unitBox = m => {
        const xs = [m[4], m[0] + m[4], m[2] + m[4], m[0] + m[2] + m[4]]
        const ys = [m[5], m[1] + m[5], m[3] + m[5], m[1] + m[3] + m[5]]
        const x = Math.min(...xs), y = Math.min(...ys)
        return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
    }
    let ctm = Array.from(viewport.transform)
    const stack = [], out = []
    const { fnArray, argsArray } = list
    for (let i = 0; i < fnArray.length && out.length < 200; i++) {
        const fn = fnArray[i], a = argsArray[i]
        if (fn === OPS.save || fn === OPS.beginGroup) stack.push(ctm)
        else if (fn === OPS.restore || fn === OPS.endGroup || fn === OPS.paintFormXObjectEnd
            || fn === OPS.endAnnotation) ctm = stack.pop() ?? ctm
        else if (fn === OPS.transform && a) ctm = mul(ctm, a)
        else if (fn === OPS.paintFormXObjectBegin) { stack.push(ctm); if (a?.[0]) ctm = mul(ctm, Array.from(a[0])) }
        else if (fn === OPS.beginAnnotation) {
            stack.push(ctm)
            if (a?.[2]) ctm = mul(ctm, Array.from(a[2]))
            if (a?.[3]) ctm = mul(ctm, Array.from(a[3]))
        }
        else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) out.push(unitBox(ctm))
        else if (fn === OPS.paintImageXObjectRepeat && a) {
            const [, sx, sy, pos] = a
            for (let j = 0; j + 1 < pos.length; j += 2) out.push(unitBox(mul(ctm, [sx, 0, 0, sy, pos[j], pos[j + 1]])))
        }
    }
    return out
}

const render = async (page, doc, zoom) => {
    // Cozy Shelves: a page is rendered again on every zoom and resize; only the newest render may fill the page
    const token = (doc.lesesaalRender = (doc.lesesaalRender || 0) + 1)
    const scale = zoom * devicePixelRatio
    doc.documentElement.style.transform = `scale(${1 / devicePixelRatio})`
    doc.documentElement.style.transformOrigin = 'top left'
    doc.documentElement.style.setProperty('--scale-factor', scale)
    const viewport = page.getViewport({ scale })

    // the canvas must be in the `PDFDocument`'s `ownerDocument`
    // (`globalThis.document` by default); that's where the fonts are loaded
    const canvas = document.createElement('canvas')
    canvas.height = viewport.height
    canvas.width = viewport.width
    const canvasContext = canvas.getContext('2d')
    const task = page.render({ canvasContext, viewport })
    // Cozy Shelves: a render that pdf.js cancels (the page left the view while it was drawn, for example when a search hit
    // moves the reader on) ends quietly; it used to surface as an unhandled RenderingCancelledException
    try { await task.promise }
    catch (e) { if (e?.name === 'RenderingCancelledException') return; throw e }
    if (doc.lesesaalRender !== token) return
    // Cozy Shelves: what the reader needs to theme the page and to cut diagrams out of it
    try { canvas.imageRects = imageRects(task, viewport) } catch { canvas.imageRects = [] }
    canvas.pageIndex = page.pageNumber - 1
    canvas.renderScale = scale
    doc.querySelector('#canvas').replaceChildren(doc.adoptNode(canvas))

    // Cozy Shelves: the text layer of the render before is cancelled and emptied first, otherwise the page text stands in
    // it twice (read aloud twice, found twice). `data-lesesaal` = 'done' tells read-aloud that the layer is complete.
    const container = doc.querySelector('.textLayer')
    // the cancelled layer is no longer the current one, so that its render ends quietly (an AbortException)
    const before = doc.lesesaalTextLayer
    doc.lesesaalTextLayer = null
    before?.cancel?.()
    container.replaceChildren()
    container.dataset.lesesaal = 'rendering'
    const textContentSource = await page.streamTextContent()
    if (doc.lesesaalRender !== token) return
    const textLayer = new pdfjsLib.TextLayer({ textContentSource, container, viewport })
    doc.lesesaalTextLayer = textLayer
    try { await textLayer.render() }
    catch (e) { if (doc.lesesaalTextLayer !== textLayer || e?.name === 'AbortException') return; throw e }
    if (doc.lesesaalRender !== token) return

    // hide "offscreen" canvases appended to docuemnt when rendering text layer
    // https://github.com/mozilla/pdf.js/blob/642b9a5ae67ef642b9a8808fd9efd447e8c350e2/web/pdf_viewer.css#L51-L58
    for (const canvas of document.querySelectorAll('.hiddenCanvasElement'))
        Object.assign(canvas.style, {
            position: 'absolute',
            top: '0',
            left: '0',
            width: '0',
            height: '0',
            display: 'none',
        })

    // fix text selection
    // https://github.com/mozilla/pdf.js/blob/642b9a5ae67ef642b9a8808fd9efd447e8c350e2/web/text_layer_builder.js#L105-L107
    const endOfContent = document.createElement('div')
    endOfContent.className = 'endOfContent'
    container.append(endOfContent)
    // TODO: this only works in Firefox; see https://github.com/mozilla/pdf.js/pull/17923
    container.onpointerdown = () => container.classList.add('selecting')
    container.onpointerup = () => container.classList.remove('selecting')
    container.dataset.lesesaal = 'done'

    const div = doc.querySelector('.annotationLayer')
    div.replaceChildren()   // Cozy Shelves: the links of the render before, see the text layer above
    const linkService = {
        goToDestination: () => {},
        getDestinationHash: dest => JSON.stringify(dest),
        addLinkAttributes: (link, url) => link.href = url,
    }
    await new pdfjsLib.AnnotationLayer({ page, viewport, div, linkService })
        .render({ annotations: await page.getAnnotations() })
}

const renderPage = async (page, getImageBlob) => {
    const viewport = page.getViewport({ scale: 1 })
    if (getImageBlob) {
        const canvas = document.createElement('canvas')
        canvas.height = viewport.height
        canvas.width = viewport.width
        const canvasContext = canvas.getContext('2d')
        await page.render({ canvasContext, viewport }).promise
        return new Promise(resolve => canvas.toBlob(resolve))
    }
    const src = URL.createObjectURL(new Blob([`
        <!DOCTYPE html>
        <html lang="en">
        <meta charset="utf-8">
        <meta name="viewport" content="width=${viewport.width}, height=${viewport.height}">
        <style>
        html, body {
            margin: 0;
            padding: 0;
        }
        /*
        https://github.com/mozilla/pdf.js/commit/bd05b255fabfc313b194bfe9a17ccded4d90fb5a
        */
        :root {
          --user-unit: 1;
          --total-scale-factor: calc(var(--scale-factor) * var(--user-unit));
          --scale-round-x: 1px;
          --scale-round-y: 1px;
        }
        ${textLayerBuilderCSS}
        ${annotationLayerBuilderCSS}
        </style>
        <div id="canvas"></div>
        <div class="textLayer"></div>
        <div class="annotationLayer"></div>
    `], { type: 'text/html' }))
    const onZoom = ({ doc, scale }) => render(page, doc, scale)
    return { src, onZoom }
}

const makeTOCItem = item => ({
    label: item.title,
    href: JSON.stringify(item.dest),
    subitems: item.items.length ? item.items.map(makeTOCItem) : null,
})

export const makePDF = async file => {
    const transport = new pdfjsLib.PDFDataRangeTransport(file.size, [])
    transport.requestDataRange = (begin, end) => {
        file.slice(begin, end).arrayBuffer().then(chunk => {
            transport.onDataRange(begin, chunk)
        })
    }
    const pdf = await pdfjsLib.getDocument({
        range: transport,
        cMapUrl: pdfjsPath('cmaps/'),
        standardFontDataUrl: pdfjsPath('standard_fonts/'),
        isEvalSupported: false,
    }).promise

    const book = { rendition: { layout: 'pre-paginated' } }

    const { metadata, info } = await pdf.getMetadata() ?? {}
    // TODO: for better results, parse `metadata.getRaw()`
    book.metadata = {
        title: metadata?.get('dc:title') ?? info?.Title,
        author: metadata?.get('dc:creator') ?? info?.Author,
        contributor: metadata?.get('dc:contributor'),
        description: metadata?.get('dc:description') ?? info?.Subject,
        language: metadata?.get('dc:language'),
        publisher: metadata?.get('dc:publisher'),
        subject: metadata?.get('dc:subject'),
        identifier: metadata?.get('dc:identifier'),
        source: metadata?.get('dc:source'),
        rights: metadata?.get('dc:rights'),
    }

    const outline = await pdf.getOutline()
    book.toc = outline?.map(makeTOCItem)

    const cache = new Map()
    book.sections = Array.from({ length: pdf.numPages }).map((_, i) => ({
        id: i,
        load: async () => {
            const cached = cache.get(i)
            if (cached) return cached
            const url = await renderPage(await pdf.getPage(i + 1))
            cache.set(i, url)
            return url
        },
        size: 1000,
    }))
    book.isExternal = uri => /^\w+:/i.test(uri)
    book.resolveHref = async href => {
        const parsed = JSON.parse(href)
        const dest = typeof parsed === 'string'
            ? await pdf.getDestination(parsed) : parsed
        const index = await pdf.getPageIndex(dest[0])
        return { index }
    }
    book.splitTOCHref = async href => {
        const parsed = JSON.parse(href)
        const dest = typeof parsed === 'string'
            ? await pdf.getDestination(parsed) : parsed
        const index = await pdf.getPageIndex(dest[0])
        return [index, null]
    }
    book.getTOCFragment = doc => doc.documentElement
    book.getCover = async () => renderPage(await pdf.getPage(1), true)
    // Cozy Shelves: the pdf.js document, so that the reader can render a part of a page again at a higher scale
    book.pdf = pdf
    book.destroy = () => pdf.destroy()
    return book
}
