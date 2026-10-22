/* The controls beside the print preview. See print-preview.cjs. */

const $ = (id) => document.getElementById(id)
const LAST = 'chas.print.printer'

function lastPrinter() {
  try {
    return localStorage.getItem(LAST)
  } catch {
    return null
  }
}

function rememberPrinter(name) {
  try {
    localStorage.setItem(LAST, name)
  } catch {
    /* Remembering is a convenience only. */
  }
}

async function start() {
  const info = await window.preview.info()
  if (!info) return
  const count = info.pages === 1 ? '1 page' : info.pages > 1 ? `${info.pages} pages` : ''
  $('pages').textContent = [info.title, count].filter(Boolean).join(' · ')

  const select = $('printer')
  const last = lastPrinter()
  const chosen =
    info.printers.find((p) => p.name === last) ?? info.printers.find((p) => p.isDefault) ?? info.printers[0]
  for (const p of info.printers) {
    const option = document.createElement('option')
    option.value = p.name
    option.textContent = p.displayName
    option.selected = p === chosen
    select.append(option)
  }
  if (info.printers.length === 0) {
    select.disabled = true
    $('none').hidden = false
    return
  }
  $('print').disabled = false
  $('print').focus()
}

async function print() {
  const button = $('print')
  const error = $('error')
  const copies = Math.min(99, Math.max(1, Math.floor(Number($('copies').value) || 1)))
  button.disabled = true
  button.textContent = 'Printing…'
  error.hidden = true
  const res = await window.preview.print($('printer').value, copies)
  if (res && res.ok) {
    rememberPrinter($('printer').value)
    return
  }
  error.textContent = `The document could not be printed${res && res.message ? ` (${res.message})` : ''}. Check the printer and try again.`
  error.hidden = false
  button.disabled = false
  button.textContent = 'Print'
}

$('print').addEventListener('click', () => void print())
$('cancel').addEventListener('click', () => void window.preview.cancel())
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') void window.preview.cancel()
})

void start()
