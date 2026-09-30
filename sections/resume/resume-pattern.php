<?php
/**
 * Title: Résumé
 * Slug: jgdzine/resume
 * Categories: jgdzine, about
 * Keywords: resume, cv, experience, timeline, skills
 * Description: Dark header band with a diagonal edge, diamond-marked experience timeline, and a skills/education sidebar.
 * Viewport Width: 1400
 *
 * Drop this file into the active block theme's patterns/ directory. Requires resume.css
 * (and the ds-bundle tokens) to be enqueued — see README.md.
 */
?>
<!-- wp:group {"tagName":"section","className":"jg-resume","layout":{"type":"default"}} -->
<section class="wp-block-group jg-resume" id="resume">

<!-- wp:group {"className":"jg-resume__head","layout":{"type":"default"}} -->
<div class="wp-block-group jg-resume__head">
<!-- wp:group {"className":"jg-resume__inner","layout":{"type":"default"}} -->
<div class="wp-block-group jg-resume__inner">

<!-- wp:group {"layout":{"type":"default"}} -->
<div class="wp-block-group">
<!-- wp:paragraph {"className":"jg-resume__eyebrow"} -->
<p class="jg-resume__eyebrow">Résumé</p>
<!-- /wp:paragraph -->

<!-- wp:heading {"className":"jg-display jg-resume__title"} -->
<h2 class="wp-block-heading jg-display jg-resume__title">Track<br>Rec<em>o</em>rd</h2>
<!-- /wp:heading -->

<!-- wp:paragraph {"className":"jg-resume__intro"} -->
<p class="jg-resume__intro">Technical engineering lead, developer, and designer with 15+ years building interactive web products from Minneapolis. I lead teams, ship the work, and design the system behind it.</p>
<!-- /wp:paragraph -->

<!-- wp:group {"className":"jg-resume__actions","layout":{"type":"default"}} -->
<div class="wp-block-group jg-resume__actions">
<!-- wp:html -->
<a class="jg-btn jg-btn--cta" href="/wp-content/uploads/joshua-giowaya-resume.pdf" download>Download PDF</a>
<a class="jg-btn" href="#contact">Get in touch</a>
<!-- /wp:html -->
</div>
<!-- /wp:group -->
</div>
<!-- /wp:group -->

<!-- wp:group {"className":"jg-resume__stats","layout":{"type":"default"}} -->
<div class="wp-block-group jg-resume__stats">
<!-- wp:html -->
<span class="jg-diamond"><p><strong>15+</strong>Years<br>building</p></span>
<span class="jg-diamond jg-diamond--solid"><p><strong>MPLS</strong>Based in<br>Minnesota</p></span>
<span class="jg-diamond"><p><strong>2009</strong>Shipping<br>since</p></span>
<!-- /wp:html -->
</div>
<!-- /wp:group -->

</div>
<!-- /wp:group -->
</div>
<!-- /wp:group -->

<!-- wp:group {"className":"jg-resume__body","layout":{"type":"default"}} -->
<div class="wp-block-group jg-resume__body">
<!-- wp:group {"className":"jg-resume__inner","layout":{"type":"default"}} -->
<div class="wp-block-group jg-resume__inner">

<!-- wp:group {"layout":{"type":"default"}} -->
<div class="wp-block-group">
<!-- wp:heading {"level":3,"className":"jg-heading jg-resume__label"} -->
<h3 class="wp-block-heading jg-heading jg-resume__label">Experience</h3>
<!-- /wp:heading -->

<!-- wp:list {"ordered":true,"className":"jg-resume__timeline"} -->
<ol class="wp-block-list jg-resume__timeline">

<!-- wp:list-item {"className":"jg-resume__entry jg-resume__entry--current"} -->
<li class="jg-resume__entry jg-resume__entry--current">
  <p class="jg-resume__dates">Nov 2022 — Present</p>
  <h4 class="jg-heading jg-resume__role">Technical Engineering Lead</h4>
  <p class="jg-resume__org">Yardstik <span>Minneapolis, MN</span></p>
  <ul class="jg-resume__bullets">
    <li>Shape technical roadmaps with executives and business partners, and lead a distributed engineering team on architecture and direction.</li>
    <li>Ship products from web apps to in-store experiences with React, Vue, Svelte, TypeScript, Laravel, and WordPress.</li>
    <li>Partner with product design on reusable design systems and pattern libraries; own the Git workflow, testing, and release process.</li>
  </ul>
</li>
<!-- /wp:list-item -->

<!-- wp:list-item {"className":"jg-resume__entry"} -->
<li class="jg-resume__entry">
  <p class="jg-resume__dates">Apr 2021 — Nov 2022</p>
  <h4 class="jg-heading jg-resume__role">Technical Engineering Lead</h4>
  <p class="jg-resume__org">Self Esteem Brands <span>Woodbury, MN</span></p>
  <ul class="jg-resume__bullets">
    <li>Led engineers across multiple locations and mentored them to raise core competency and team velocity.</li>
    <li>Established Git workflow, testing, and CI/CD release process; set coding standards enforced through linting, pre-commit checks, and reviews.</li>
  </ul>
</li>
<!-- /wp:list-item -->

<!-- wp:list-item {"className":"jg-resume__entry"} -->
<li class="jg-resume__entry">
  <p class="jg-resume__dates">Dec 2016 — 2021</p>
  <h4 class="jg-heading jg-resume__role">Sr. Software Engineer</h4>
  <p class="jg-resume__org">Code42 <span>Minneapolis, MN</span></p>
  <ul class="jg-resume__bullets">
    <li>Built web applications on REST services with Redux state and React, Angular, and Backbone UIs; custom responsive WordPress themes and plugins.</li>
    <li>Represented the company at tech conferences as an evangelist for its web application approach.</li>
  </ul>
</li>
<!-- /wp:list-item -->

<!-- wp:list-item {"className":"jg-resume__entry"} -->
<li class="jg-resume__entry">
  <p class="jg-resume__dates">Sep 2014 — Dec 2020</p>
  <h4 class="jg-heading jg-resume__role">Lead Web &amp; Software Engineer</h4>
  <p class="jg-resume__org">Linnihan Foy <span>Minneapolis, MN</span></p>
  <ul class="jg-resume__bullets">
    <li>Led development turning mockups into fully functioning corporate websites and web applications.</li>
    <li>Defined the designer-to-developer workflow (Sass, Grunt/Gulp, Git) and used analytics to cut load time on the highest-traffic pages.</li>
  </ul>
</li>
<!-- /wp:list-item -->

<!-- wp:list-item {"className":"jg-resume__entry"} -->
<li class="jg-resume__entry">
  <p class="jg-resume__dates">2014 — 2015</p>
  <h4 class="jg-heading jg-resume__role">UI / Web Engineer</h4>
  <p class="jg-resume__org">Rocket55 <span>Minneapolis, MN</span></p>
  <ul class="jg-resume__bullets">
    <li>Built pixel-perfect responsive sites with designers and the SEO team; designed pages in Photoshop and Illustrator.</li>
    <li>Developed multi-page PHP/MySQL applications and a custom WordPress plugin.</li>
  </ul>
</li>
<!-- /wp:list-item -->

<!-- wp:list-item {"className":"jg-resume__entry"} -->
<li class="jg-resume__entry">
  <p class="jg-resume__dates">2012 — 2013</p>
  <h4 class="jg-heading jg-resume__role">Web Engineer &amp; Graphic Designer</h4>
  <p class="jg-resume__org">The Alt Bike and Board</p>
  <ul class="jg-resume__bullets">
    <li>Designed and developed the company website, plus print for t-shirts, totes, posters, logos, and marketing material.</li>
  </ul>
</li>
<!-- /wp:list-item -->

<!-- wp:list-item {"className":"jg-resume__entry"} -->
<li class="jg-resume__entry">
  <p class="jg-resume__dates">Jan 2009 — Mar 2010</p>
  <h4 class="jg-heading jg-resume__role">Web Engineer</h4>
  <p class="jg-resume__org">Shop Jimmy <span>Minneapolis, MN</span></p>
  <ul class="jg-resume__bullets">
    <li>Designed and built the Magento e-commerce site and a real-time in-store and online inventory app (ActionScript, Flex, AIR).</li>
  </ul>
</li>
<!-- /wp:list-item -->

</ol>
<!-- /wp:list -->
</div>
<!-- /wp:group -->

<!-- wp:group {"tagName":"aside","className":"jg-resume__aside","layout":{"type":"default"}} -->
<aside class="wp-block-group jg-resume__aside">

<!-- wp:group {"className":"jg-resume__block","layout":{"type":"default"}} -->
<div class="wp-block-group jg-resume__block">
<!-- wp:heading {"level":3,"className":"jg-heading jg-resume__label"} -->
<h3 class="wp-block-heading jg-heading jg-resume__label">Skills</h3>
<!-- /wp:heading -->
<!-- wp:html -->
<div class="jg-resume__group"><p class="jg-resume__group-name">Build</p><ul class="jg-resume__tags"><li>JavaScript / TypeScript</li><li>React</li><li>Vue</li><li>Angular</li><li>Svelte</li><li>Node</li><li>PHP</li><li>Python</li></ul></div>
<div class="jg-resume__group"><p class="jg-resume__group-name">Platforms</p><ul class="jg-resume__tags"><li>WordPress</li><li>Laravel</li><li>Magento</li><li>REST / GraphQL</li><li>Docker</li><li>AWS</li></ul></div>
<div class="jg-resume__group"><p class="jg-resume__group-name">Data</p><ul class="jg-resume__tags"><li>MySQL</li><li>Postgres</li><li>MongoDB</li><li>Elasticsearch</li></ul></div>
<div class="jg-resume__group"><p class="jg-resume__group-name">Design</p><ul class="jg-resume__tags"><li>Figma</li><li>Sketch</li><li>Adobe CS</li><li>InVision</li></ul></div>
<div class="jg-resume__group"><p class="jg-resume__group-name">Practice</p><ul class="jg-resume__tags"><li>TDD / Jest</li><li>CI / CD</li><li>Agile / Jira</li><li>Accessibility</li></ul></div>
<!-- /wp:html -->
</div>
<!-- /wp:group -->

<!-- wp:group {"className":"jg-resume__block","layout":{"type":"default"}} -->
<div class="wp-block-group jg-resume__block">
<!-- wp:heading {"level":3,"className":"jg-heading jg-resume__label"} -->
<h3 class="wp-block-heading jg-heading jg-resume__label">Focus</h3>
<!-- /wp:heading -->
<!-- wp:html -->
<ul class="jg-resume__edu">
<li><strong>Team leadership</strong><span>Mentoring distributed engineers, roadmaps with executives.</span></li>
<li><strong>Design systems</strong><span>Reusable pattern libraries built with product design.</span></li>
<li><strong>Release engineering</strong><span>Git workflow, testing, linting, CI/CD, on-time releases.</span></li>
<li><strong>Compliance</strong><span>Accessibility, data retention, and security standards.</span></li>
</ul>
<!-- /wp:html -->
</div>
<!-- /wp:group -->

<!-- wp:group {"className":"jg-resume__block","layout":{"type":"default"}} -->
<div class="wp-block-group jg-resume__block">
<!-- wp:heading {"level":3,"className":"jg-heading jg-resume__label"} -->
<h3 class="wp-block-heading jg-heading jg-resume__label">Reach me</h3>
<!-- /wp:heading -->
<!-- wp:html -->
<ul class="jg-resume__contact">
<li><a href="mailto:joshuagiowaya@gmail.com">joshuagiowaya@gmail.com</a></li>
<li><a href="tel:+16126699349">612.669.9349</a></li>
<li><a href="https://joshuagiowaya.com">joshuagiowaya.com</a></li>
<li>Minneapolis, MN</li>
</ul>
<!-- /wp:html -->
</div>
<!-- /wp:group -->

</aside>
<!-- /wp:group -->

</div>
<!-- /wp:group -->
</div>
<!-- /wp:group -->

</section>
<!-- /wp:group -->
