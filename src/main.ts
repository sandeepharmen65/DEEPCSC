import "./assets/main.css";
import { createApp } from "vue";
import App from "./App.vue";
import { Amplify } from "aws-amplify";
import outputs from "../amplify_outputs.json";
import { inject } from '@vercel/analytics';

Amplify.configure(outputs);

inject();

createApp(App).mount("#app");
