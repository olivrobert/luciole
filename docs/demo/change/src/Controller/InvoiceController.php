<?php

namespace App\Controller;

use App\Message\Command\PayInvoice;
use App\Model\Invoice;
use App\Model\User;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Messenger\MessageBusInterface;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\CurrentUser;

final class InvoiceController extends AbstractController
{
    public function __construct(
        private readonly MessageBusInterface $commandBus,
        private readonly EntityManagerInterface $entityManager,
    ) {
    }

    #[Route('/invoices/{uuid}/pay', name: 'invoice_pay', methods: ['POST'])]
    public function pay(Invoice $invoice, #[CurrentUser] User $user): Response
    {
        $this->commandBus->dispatch(new PayInvoice($invoice->uuid, $user->uuid));

        return $this->redirectToRoute('invoice_show', ['uuid' => $invoice->uuid]);
    }

    #[Route('/invoices/{uuid}/cancel', name: 'invoice_cancel', methods: ['POST'])]
    public function cancel(Invoice $invoice): Response
    {
        $invoice->cancel($this->getUser());
        $this->entityManager->flush();

        return $this->redirectToRoute('invoice_show', ['uuid' => $invoice->uuid]);
    }
}
