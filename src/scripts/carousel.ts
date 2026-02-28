const carousel = document.getElementById("carousel");
if (carousel) {
  const totalPages = parseInt(carousel.dataset.totalPages || "1");
  const interval = parseInt(carousel.dataset.interval || "10") * 1000;
  const pages = carousel.querySelectorAll<HTMLElement>(".carousel-page");
  const dots = document.querySelectorAll<HTMLElement>(".page-dot");
  const progressFill = document.getElementById("progressFill");
  let current = 0;
  let timer: ReturnType<typeof setTimeout>;
  let animFrame: number = 0;

  function showPage(idx: number) {
    pages.forEach((p, i) => {
      p.classList.toggle("active", i === idx);
      p.classList.toggle("exit", i !== idx);
    });
    dots.forEach((d, i) => d.classList.toggle("active", i === idx));
    current = idx;
    startProgress();
  }

  function startProgress() {
    if (!progressFill || totalPages <= 1) return;
    cancelAnimationFrame(animFrame);
    progressFill.style.transition = "none";
    progressFill.style.width = "0%";

    requestAnimationFrame(() => {
      progressFill.style.transition = `width ${interval}ms linear`;
      progressFill.style.width = "100%";
    });
  }

  function nextPage() {
    showPage((current + 1) % totalPages);
  }

  if (totalPages > 1) {
    timer = setInterval(nextPage, interval);
    startProgress();

    dots.forEach((dot) => {
      dot.addEventListener("click", () => {
        clearInterval(timer);
        showPage(parseInt(dot.dataset.dot || "0"));
        timer = setInterval(nextPage, interval);
      });
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        clearInterval(timer);
        if (e.key === "ArrowRight") showPage((current + 1) % totalPages);
        else showPage((current - 1 + totalPages) % totalPages);
        timer = setInterval(nextPage, interval);
      }
    });
  }
}
