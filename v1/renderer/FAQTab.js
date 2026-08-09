'use strict'

window.coherenceFaq = {
  render(container) {
    const items = window.coherenceI18n.text('faqItems')
    container.innerHTML = ''
    items.forEach((item, index) => {
      const details = document.createElement('details')
      details.className = 'faq-item'
      details.open = index === 0
      const summary = document.createElement('summary')
      summary.textContent = item.question
      const answer = document.createElement('p')
      answer.textContent = item.answer
      details.append(summary, answer)
      container.appendChild(details)
    })
  }
}
