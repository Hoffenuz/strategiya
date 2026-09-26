import './styles.css';
import { App } from './ui/app';

const root = document.getElementById('app');
if (!root) throw new Error('#app missing');
new App(root);
